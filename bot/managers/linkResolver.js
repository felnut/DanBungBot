const cache = require("./musicCache");
const ytdlp = require("./ytdlp");

const UPDATE_COOLDOWN_MS = 60 * 60 * 1000; // yt-dlp 업데이트는 최대 1시간에 한 번

// 영상 자체의 문제(비공개·삭제·연령 제한 등)는 yt-dlp를 업데이트해도 해결되지 않음
const VIDEO_PROBLEM =
  /unavailable|private video|has been removed|not available|confirm your age|members-only|copyright|live event will begin|premieres in|terminated/i;

let updating = null; // 진행 중인 업데이트 Promise (동시에 여러 요청이 실패해도 한 번만 실행)
let lastUpdateAt = 0;

// 허용 링크 (이 외의 주소는 Lavalink에 넘기지 않음: 내부망 접근 등 SSRF 방지)
const YOUTUBE_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"];
const DIRECT_HOSTS = [
  "soundcloud.com",
  "www.soundcloud.com",
  "m.soundcloud.com",
  "on.soundcloud.com",
  "twitch.tv",
  "www.twitch.tv",
  "vimeo.com",
  "www.vimeo.com",
];
const isBandcamp = (host) => host === "bandcamp.com" || host.endsWith(".bandcamp.com");

class ResolveError extends Error {
  constructor(userMessage) {
    super(userMessage);
    this.userMessage = userMessage;
  }
}

function parseUrl(text) {
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/** yt-dlp를 최신 버전으로 업데이트 (쿨다운 안에서는 하지 않음). 업데이트를 실행했으면 true */
function updateYtdlp() {
  if (updating) return updating;
  if (Date.now() - lastUpdateAt < UPDATE_COOLDOWN_MS) return Promise.resolve(false);
  lastUpdateAt = Date.now();
  console.log("🎵 yt-dlp 추출 실패 → 업데이트를 시도합니다");
  updating = ytdlp.update().finally(() => {
    updating = null;
  });
  return updating;
}

/** 추출에 실패하면 (영상 문제가 아닌 한) yt-dlp를 업데이트하고 한 번만 재시도한다 */
async function extract(target, prefetch = false) {
  try {
    return await ytdlp.extract(target);
  } catch (e) {
    const detail = String(e.message || e);
    console.error("🎵 yt-dlp 실패:", detail.trim().slice(-300));
    if (VIDEO_PROBLEM.test(detail)) {
      throw new ResolveError("이 영상은 재생할 수 없어요. (비공개·삭제·연령/지역 제한 등)");
    }
    // 미리 준비(자동완성) 단계의 실패는 업데이트를 소모하지 않고, 실제 명령 때 다시 판단한다
    if (prefetch || !(await updateYtdlp())) {
      throw new ResolveError("유튜브에서 곡 정보를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    try {
      return await ytdlp.extract(target);
    } catch (e2) {
      console.error("🎵 yt-dlp 재시도 실패:", String(e2.message || e2).slice(0, 200));
      throw new ResolveError("유튜브에서 곡 정보를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  }
}

/** 캐시된 파일로 재생 (yt-dlp 호출 없음) */
function fromCache(id, hit) {
  return { identifier: hit.url, meta: hit.meta, cacheId: id };
}

/** 스트림 주소로 바로 재생하고, 같은 곡을 다음에 쓰도록 백그라운드로 저장 (미리 준비 단계에서는 저장하지 않음) */
function fromInfo(info, prefetch) {
  if (!prefetch) cache.store(info);
  return { identifier: info.url, meta: info };
}

/**
 * 사용자 입력을 Lavalink에 넘길 식별자로 변환한다.
 * @param {string} input 검색어 또는 URL
 * @param {"soundcloud"|"youtube"} source 검색어일 때 사용할 소스
 * @param {{prefetch?: boolean}} [opts] prefetch: 자동완성 단계의 미리 준비 (캐시 저장은 하지 않음)
 * @returns {Promise<{identifier: string, meta?: object, cacheId?: string}>}
 */
async function resolveInput(input, source = "soundcloud", opts = {}) {
  const text = input.trim();
  const url = parseUrl(text);

  if (!url) {
    // http(s)가 아닌 주소(file:// 등)는 검색어로도 넘기지 않음
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
      throw new ResolveError("지원하지 않는 링크예요. (유튜브, 사운드클라우드, 밴드캠프, 트위치, 비메오)");
    }
    if (source === "youtube") {
      const cachedId = cache.lookupSearch(text);
      const hit = cachedId && cache.find(cachedId);
      if (hit) return fromCache(cachedId, hit);
      // 검색 결과(자동완성에서 이미 조회했다면 메모 사용)의 첫 영상을 링크와 같은 경로로 처리한다
      let id = null;
      try {
        id = (await ytdlp.search(text, 5))[0]?.id ?? null;
      } catch {
        /* 검색 실패 시 아래에서 ytsearch1로 재시도 */
      }
      if (id) {
        cache.saveSearch(text, id);
        const found = cache.find(id);
        if (found) return fromCache(id, found);
        return fromInfo(await extract("https://www.youtube.com/watch?v=" + id, opts.prefetch), opts.prefetch);
      }
      const info = await extract("ytsearch1:" + text, opts.prefetch);
      cache.saveSearch(text, info.id);
      return fromInfo(info, opts.prefetch);
    }
    return { identifier: text }; // 기본: Lavalink 기본 검색(사운드클라우드)
  }

  const host = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.includes(host)) {
    if (url.pathname.startsWith("/playlist")) {
      throw new ResolveError("유튜브 재생목록 링크는 아직 지원하지 않아요. 곡 링크를 넣어 주세요.");
    }
    const id = cache.extractVideoId(url);
    const hit = id && cache.find(id);
    if (hit) return fromCache(id, hit);
    return fromInfo(await extract(text, opts.prefetch), opts.prefetch);
  }
  if (DIRECT_HOSTS.includes(host) || isBandcamp(host)) {
    return { identifier: text };
  }
  throw new ResolveError("지원하지 않는 링크예요. (유튜브, 사운드클라우드, 밴드캠프, 트위치, 비메오)");
}

/** yt-dlp 메타데이터를 Lavalink 트랙 정보에 덮어쓴다 (http 소스는 제목이 비어 있음) */
function applyMeta(track, meta) {
  if (!meta) return;
  if (meta.title) track.info.title = meta.title;
  if (meta.uploader) track.info.author = meta.uploader;
  if (meta.thumbnail) track.info.artworkUrl = meta.thumbnail;
  if (meta.webpage_url) track.info.uri = meta.webpage_url;
}

module.exports = { resolveInput, applyMeta, ResolveError };
