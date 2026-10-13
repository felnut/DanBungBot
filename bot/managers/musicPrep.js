const { getMusicManager } = require("./musicManager");
const { resolveInput, applyMeta } = require("./linkResolver");
const musicCache = require("./musicCache");
const ytdlp = require("./ytdlp");

// 곡 준비 단계: (1) 링크/검색어 해석(yt-dlp) → (2) Lavalink에 곡 로드.
// 자동완성 단계에서 미리 실행해 두고 결과를 메모하면, 사용자가 엔터를 눌렀을 때는 이미 끝나 있다.
const TRACK_TTL_MS = 10 * 60 * 1000;
const TRACK_MEMO_MAX = 100;
const trackMemo = new Map(); // key -> { t, promise }

const PREFETCH_DEBOUNCE_MS = 300; // 링크 입력이 이만큼 멈췄을 때만 미리 준비 (타자 입력마다 요청하지 않음)
const PREFETCH_MAX_ACTIVE = 3; // 동시에 진행하는 미리 준비 개수 상한
const prefetchTimers = new Map(); // userId -> Timeout
let prefetchActive = 0;

const SUGGEST_COUNT = 5;

const isUrl = (s) => /^https?:\/\//i.test(s);
const failed = (res) => res.loadType === "error" || res.loadType === "empty" || !res.tracks.length;

/** Lavalink에 곡을 로드한다 (결과 메모). 요청자별로 트랙 객체를 복제해 돌려준다 */
async function loadTracks(identifier, requester) {
  const manager = getMusicManager();
  const key = identifier;
  let entry = trackMemo.get(key);
  if (!entry || Date.now() - entry.t > TRACK_TTL_MS) {
    const node = manager?.nodeManager.leastUsedNodes()[0];
    if (!node) throw new Error("NO_NODE");
    // 링크는 그대로, 검색어는 사운드클라우드에서 찾는다
    const query = isUrl(identifier) ? { query: identifier } : { query: identifier, source: "soundcloud" };
    const promise = node.search(query, null);
    entry = { t: Date.now(), promise };
    trackMemo.set(key, entry);
    promise.then(
      (res) => {
        if (failed(res)) trackMemo.delete(key); // 실패·빈 결과는 기억하지 않음
      },
      () => trackMemo.delete(key),
    );
    if (trackMemo.size > TRACK_MEMO_MAX) trackMemo.delete(trackMemo.keys().next().value);
  }
  const res = await entry.promise;
  return {
    ...res,
    tracks: res.tracks.map((t) => {
      const c = JSON.parse(JSON.stringify(t)); // 여러 요청이 같은 객체를 공유하지 않도록 복제
      c.requester = requester;
      return c;
    }),
  };
}

/**
 * 입력(검색어/링크)을 재생 가능한 Lavalink 트랙으로 준비한다.
 * @returns {Promise<{res: object, resolved: object}>} res: Lavalink 검색 결과, resolved: 해석 결과
 */
async function prepareTrack(query, source, requester, { prefetch = false } = {}) {
  let resolved = await resolveInput(query, source, { prefetch });
  let res = await loadTracks(resolved.identifier, requester);

  // 캐시 파일이 깨져서 못 읽으면 캐시를 지우고 원본에서 다시 가져온다
  if (resolved.cacheId && failed(res)) {
    musicCache.remove(resolved.cacheId);
    resolved = await resolveInput(query, source, { prefetch });
    res = await loadTracks(resolved.identifier, requester);
  }
  if (!failed(res) && resolved.meta) applyMeta(res.tracks[0], resolved.meta);
  return { res, resolved };
}

// ---- 자동완성: 검색 결과 상위 5개 ----
const fmtDuration = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

/** 선택지 한 줄: "[3:55] 제목 · 채널" (디스코드 선택지 이름은 100자 이하) */
function choiceName(title, author, durationSec, isLive) {
  const tag = isLive ? "🔴 LIVE" : durationSec ? `[${fmtDuration(durationSec)}]` : "";
  const text = [tag, title || "(제목 없음)"].filter(Boolean).join(" ") + (author ? ` · ${author}` : "");
  return text.length > 100 ? text.slice(0, 99) + "…" : text;
}

/**
 * 검색어에 대한 상위 5개 결과를 자동완성 선택지로 만든다.
 * 유튜브는 영상만(채널·재생목록 제외), 값은 영상 링크라서 고르면 링크 재생 경로(캐시·미리 준비)를 탄다.
 * @returns {Promise<Array<{name: string, value: string}>>}
 */
async function suggest(query, source) {
  if (source === "youtube") {
    const results = await ytdlp.search(query, SUGGEST_COUNT);
    return results.slice(0, SUGGEST_COUNT).map((r) => ({
      name: choiceName(r.title, r.uploader, r.duration, r.is_live),
      value: `https://youtu.be/${r.id}`,
    }));
  }
  // 사운드클라우드
  const node = getMusicManager()?.nodeManager.leastUsedNodes()[0];
  if (!node) return [];
  const res = await node.search({ query, source: "soundcloud" }, null);
  if (failed(res)) return [];
  return res.tracks.slice(0, SUGGEST_COUNT).map((t) => ({
    name: choiceName(t.info.title, t.info.author, t.info.duration / 1000, t.info.isStream),
    // 선택지 값은 100자 이하만 가능: 링크가 길면 제목으로 대신 검색하게 한다
    value: t.info.uri && t.info.uri.length <= 100 ? t.info.uri : `${t.info.title}`.slice(0, 100),
  }));
}

// ---- 미리 준비 ----
/** 미리 준비해도 되는 입력인가 (완성된 링크만. 입력 도중의 잘린 유튜브 링크는 제외) */
function isPrefetchable(text) {
  if (!isUrl(text)) return false;
  let url;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const isYoutube = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host);
  return isYoutube ? Boolean(musicCache.extractVideoId(url)) : true;
}

/** 곡을 지금 바로 미리 준비한다 (실패해도 조용히 무시) */
async function prefetchNow(text, source) {
  if (prefetchActive >= PREFETCH_MAX_ACTIVE || !isPrefetchable(text)) return;
  prefetchActive++;
  try {
    await prepareTrack(text, source, null, { prefetch: true });
  } catch {
    /* 해석 불가·미지원 링크 등은 실제 명령 때 안내하므로 여기선 무시 */
  } finally {
    prefetchActive--;
  }
}

/** 링크 입력이 잠시 멈추면 미리 준비한다 (검색어는 suggest 단계에서 상위 결과를 미리 준비) */
function schedulePrefetch(userId, text, source) {
  clearTimeout(prefetchTimers.get(userId));
  const query = (text || "").trim();
  if (!isPrefetchable(query)) return;
  prefetchTimers.set(
    userId,
    setTimeout(() => {
      prefetchTimers.delete(userId);
      prefetchNow(query, source);
    }, PREFETCH_DEBOUNCE_MS),
  );
}

module.exports = { prepareTrack, schedulePrefetch, prefetchNow, suggest, failed };
