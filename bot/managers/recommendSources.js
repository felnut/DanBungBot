// 음악 추천의 기준이 되는 사이트: 주소 확인(허용 목록)과 곡 목록 가져오기
// 지원: 유튜브·유튜브 뮤직 재생목록, 사운드클라우드 재생목록, 스포티파이 재생목록·앨범, 멜론 차트(공식 멜론 MCP 서버)
// 멜론 사이트 페이지는 읽지 않는다 (사이트의 robots.txt가 자동 수집을 막고 있어서 공식 서버만 쓴다).
const axios = require("axios");
const ytdlp = require("./ytdlp");

class SourceError extends Error {
  constructor(userMessage) {
    super(userMessage);
    this.userMessage = userMessage;
  }
}

const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);
const SC_HOSTS = new Set([
  "soundcloud.com",
  "www.soundcloud.com",
  "m.soundcloud.com",
]);
const MAX_PER_SOURCE = 100; // 사이트 하나에서 가져올 최대 곡 수
const CACHE_TTL_MS = 60 * 60 * 1000; // 목록은 1시간 동안 기억해 사이트에 자주 요청하지 않는다

const SUPPORTED_TEXT =
  "유튜브·유튜브 뮤직 재생목록, 사운드클라우드 재생목록, 스포티파이 재생목록·앨범, 멜론 차트";

const spotifyConfigured = () =>
  Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
// 연동 키가 없거나 API가 막힌 재생목록은 스포티파이의 공개 웹 페이지(robots.txt가 허용하는 /playlist/, /album/, /track/)에서 읽는다.
// SPOTIFY_WEB_FALLBACK=0 으로 끈다. (스포티파이 이용약관은 자동 수집을 금지하므로, 소규모·저빈도로만 쓰고 결과는 1시간 보관한다)
const webFallbackEnabled = () => process.env.SPOTIFY_WEB_FALLBACK !== "0";
const spotifyUsable = () => spotifyConfigured() || webFallbackEnabled();

// 서버 운영자가 사이트를 하나도 등록하지 않았을 때 쓰는 기본 사이트 (등록한 사이트가 있으면 그쪽이 우선)
// 유튜브 뮤직 차트는 유튜브가 직접 운영하는 국가별 차트 재생목록이다.
// category는 /음악추천 차트에서 묶어 보여주는 제목이다.
const DEFAULT_SOURCES = [
  {
    kind: "youtube",
    category: "한국",
    label: "유튜브 뮤직 한국 차트",
    url: "https://www.youtube.com/playlist?list=PL4fGSI1pDJn5S09aId3dUGp40ygUqmPGc",
  },
  // 멜론: 사이트를 읽지 않고, 카카오엔터테인먼트가 운영하는 공식 멜론 MCP 서버의 실시간 TOP 100 차트를 쓴다.
  { kind: "melon", category: "한국", label: "멜론 차트", url: "melon:TOP_100" },
];
// 스포티파이 Top 50 (키가 없으면 웹 페이지 방식으로 읽는다. 읽지 못하면 그 사이트만 건너뛴다)
const SPOTIFY_DEFAULT_SOURCES = [
  {
    kind: "spotify",
    category: "한국",
    label: "스포티파이 한국 Top 50",
    url: "https://open.spotify.com/playlist/37i9dQZEVXbNxXF4SkHj9F",
  },
  {
    kind: "spotify",
    category: "글로벌",
    label: "스포티파이 글로벌 Top 50",
    url: "https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF",
  },
];

/** 기본 사이트 목록 */
function defaultSources() {
  return spotifyUsable()
    ? [...DEFAULT_SOURCES, ...SPOTIFY_DEFAULT_SOURCES]
    : [...DEFAULT_SOURCES];
}

/** 서버 운영자가 입력한 주소를 확인하고 정리한다. 지원하지 않거나 잘못된 주소면 SourceError */
function parseSource(text) {
  let url;
  try {
    url = new URL(String(text ?? "").trim());
  } catch {
    throw new SourceError(
      `❌ 주소 형식이 올바르지 않아요. 지원: ${SUPPORTED_TEXT}`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SourceError(
      `❌ 주소 형식이 올바르지 않아요. 지원: ${SUPPORTED_TEXT}`,
    );
  }
  const host = url.hostname.toLowerCase();

  if (YT_HOSTS.has(host)) {
    const list = url.searchParams.get("list");
    if (!list || !/^[A-Za-z0-9_-]{10,64}$/.test(list)) {
      throw new SourceError(
        "❌ 유튜브는 재생목록 주소(`...list=...`)만 등록할 수 있어요. 재생목록을 열어서 주소를 복사해 주세요.",
      );
    }
    return {
      kind: "youtube",
      label: host === "music.youtube.com" ? "유튜브 뮤직" : "유튜브",
      url: `https://www.youtube.com/playlist?list=${list}`,
    };
  }

  if (SC_HOSTS.has(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2)
      throw new SourceError(
        "❌ 사운드클라우드는 재생목록(sets) 또는 사용자 곡 목록 주소만 등록할 수 있어요.",
      );
    return {
      kind: "soundcloud",
      label: "사운드클라우드",
      url: `https://soundcloud.com/${parts.join("/")}`,
    };
  }

  if (host === "open.spotify.com") {
    const m = url.pathname.match(
      /(?:^|\/)(playlist|album)\/([A-Za-z0-9]{22})(?:\/|$)/,
    );
    if (!m)
      throw new SourceError(
        "❌ 스포티파이는 재생목록 또는 앨범 주소만 등록할 수 있어요.",
      );
    if (!spotifyUsable()) {
      throw new SourceError(
        "❌ 스포티파이는 봇 운영자가 연동 키(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET)를 설정해야 쓸 수 있어요. 지금은 사용할 수 없어요.",
      );
    }
    return {
      kind: "spotify",
      label: "스포티파이",
      url: `https://open.spotify.com/${m[1]}/${m[2]}`,
    };
  }

  if (host === "melon.com" || host.endsWith(".melon.com")) {
    // 멜론 차트 주소는 사이트를 읽지 않고 공식 멜론 MCP 서버의 실시간 TOP 100으로 처리한다
    if (/^\/chart(\/|$)/.test(url.pathname))
      return { kind: "melon", label: "멜론 차트", url: "melon:TOP_100" };
    throw new SourceError(
      "❌ 멜론은 차트 주소(`melon.com/chart/...`)만 등록할 수 있어요.",
    );
  }
  throw new SourceError(`❌ 지원하지 않는 사이트예요. 지원: ${SUPPORTED_TEXT}`);
}

// ---------- 스포티파이 (공식 API, 키는 .env) ----------
let spotifyToken = null; // { value, expiresAt }

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyToken.expiresAt)
    return spotifyToken.value;
  const basic = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`,
  ).toString("base64");
  const res = await axios.post(
    "https://accounts.spotify.com/api/token",
    "grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 8000,
    },
  );
  spotifyToken = {
    value: res.data.access_token,
    expiresAt: Date.now() + (res.data.expires_in - 60) * 1000,
  };
  return spotifyToken.value;
}

async function fetchSpotifyApi(url) {
  const m = new URL(url).pathname.match(
    /\/(playlist|album)\/([A-Za-z0-9]{22})/,
  );
  const [, type, id] = m;
  let token;
  try {
    token = await getSpotifyToken();
  } catch {
    // 오류 객체에는 인증 정보가 들어 있을 수 있으므로 내용을 기록하지 않는다
    throw new SourceError(
      "스포티파이에 연결하지 못했어요. 봇 운영자가 연동 키를 확인해야 해요.",
    );
  }
  const endpoint =
    type === "playlist"
      ? `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100&market=KR&fields=items(track(name,artists(name),is_local))`
      : `https://api.spotify.com/v1/albums/${id}/tracks?limit=50&market=KR`;
  let data;
  try {
    data = (
      await axios.get(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000,
      })
    ).data;
  } catch (e) {
    const status = e?.response?.status;
    if (status === 401) spotifyToken = null;
    throw new SourceError(
      status === 404 || status === 403
        ? "스포티파이가 이 재생목록을 읽도록 허용하지 않았어요. 공식 큐레이션 재생목록은 제한될 수 있으니 공개로 만든 재생목록을 써 보세요."
        : `스포티파이에서 목록을 가져오지 못했어요${status ? ` (${status})` : ""}.`,
    );
  }
  const items =
    type === "playlist"
      ? data.items.map((i) => i.track).filter((t) => t && !t.is_local)
      : data.items;
  return items
    .filter((t) => t?.name)
    .map((t) => ({
      title: t.name,
      artist: (t.artists ?? []).map((a) => a.name).join(", "),
      url: null,
    }));
}

// ---------- 스포티파이 공개 웹 페이지 (키 없이) ----------
const WEB_UA =
  "Mozilla/5.0 (compatible; OMNI-Bot; +https://github.com/felnut/OMNI-Bot)";
const WEB_MAX_TRACKS = 20; // 페이지에 곡이 더 있어도 앞쪽 20곡만 읽는다 (요청 수를 줄이기 위해)
const WEB_CONCURRENCY = 4;

const decodeEntities = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

async function getPage(url) {
  const res = await axios.get(url, {
    headers: { "User-Agent": WEB_UA, "Accept-Language": "en-US,en;q=0.9" },
    timeout: 10_000,
    responseType: "text",
    maxContentLength: 2 * 1024 * 1024,
  });
  return String(res.data);
}

/** 곡 페이지의 제목("곡명 - song and lyrics by 가수 | Spotify")에서 곡명과 가수를 읽는다 */
async function fetchTrackInfo(id) {
  const html = await getPage(`https://open.spotify.com/track/${id}`);
  const raw = html.match(/<title>(.*?)<\/title>/s)?.[1];
  if (!raw) return null;
  const title = decodeEntities(raw).trim();
  const m = title.match(
    /^(.+) - (?:song and lyrics|Song, Lyrics, and Music Video|Song)\s+by\s+(.+?)\s*\|\s*Spotify$/i,
  );
  if (m) return { title: m[1].trim(), artist: m[2].trim(), url: null };
  const bare = title.replace(/\s*\|\s*Spotify$/i, "").trim();
  return bare ? { title: bare, artist: "", url: null } : null;
}

/** 재생목록·앨범 페이지에서 곡 순서(순위)를 읽고, 곡마다 제목을 읽는다 */
async function fetchSpotifyWeb(url) {
  const m = new URL(url).pathname.match(
    /\/(playlist|album)\/([A-Za-z0-9]{22})/,
  );
  let html;
  try {
    html = await getPage(`https://open.spotify.com/${m[1]}/${m[2]}`);
  } catch (e) {
    console.error(
      "🎧 스포티파이 페이지 요청 실패:",
      e?.response?.status ?? e?.code ?? "오류",
    );
    throw new SourceError(
      "스포티파이 페이지를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  }
  const ids = [
    ...new Set(
      [
        ...html.matchAll(
          /name="music:song" content="https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]{22})"/g,
        ),
      ].map((x) => x[1]),
    ),
  ].slice(0, WEB_MAX_TRACKS);
  if (!ids.length)
    throw new SourceError(
      "스포티파이 페이지에서 곡 목록을 찾지 못했어요. 비공개이거나 페이지 구성이 바뀌었을 수 있어요.",
    );

  // 순서를 지키기 위해 자리를 정해 두고, 동시에 몇 개씩만 요청한다. 실패한 곡은 한 번 더 시도한다
  const infos = new Array(ids.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const i = next++;
      infos[i] = await fetchTrackInfo(ids[i]).catch(() =>
        fetchTrackInfo(ids[i]).catch(() => null),
      );
    }
  };
  await Promise.all(Array.from({ length: WEB_CONCURRENCY }, worker));
  const tracks = infos.filter(Boolean);
  if (!tracks.length)
    throw new SourceError("스포티파이 곡 정보를 읽지 못했어요.");
  return tracks;
}

/** 키가 있으면 공식 API를 먼저 쓰고, 키가 없거나 API가 막히면 공개 웹 페이지 방식으로 읽는다 */
async function fetchSpotify(url) {
  if (spotifyConfigured()) {
    try {
      return await fetchSpotifyApi(url);
    } catch (e) {
      if (!(e instanceof SourceError) || !webFallbackEnabled()) throw e;
    }
  }
  if (!webFallbackEnabled()) {
    throw new SourceError(
      "스포티파이는 봇 운영자가 연동 키를 설정해야 읽을 수 있어요.",
    );
  }
  return fetchSpotifyWeb(url);
}

// ---------- 멜론 (카카오엔터테인먼트의 공식 멜론 MCP 서버) ----------
// 멜론 사이트 페이지를 읽지 않는다. 공식 서버(https://mcp.melon.com/mcp/)의 get_music_chart를 부른다 (차트 조회는 로그인 없이 가능).
const MELON_MCP_URL = "https://mcp.melon.com/mcp/";
const MELON_TOP = 10; // 1~10위만 가져온다 (한 번의 요청)

/** 멜론 서버 응답 글(작은따옴표를 쓰는 파이썬 표기 형태)을 해석한다. 딕셔너리·배열·글자·숫자·true/false/None만 다룬다 */
function parseLooseLiteral(src) {
  if (typeof src !== "string" || src.length > 400_000)
    throw new Error("응답이 너무 크거나 형식이 달라요");
  let i = 0;
  const skipWs = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  // 멜론 서버는 글자 안의 따옴표를 이스케이프하지 않는다 (예: 'Girls' Generation'). 따옴표 뒤가 다음 항목으로 이어질 때만 글자의 끝으로 본다.
  const isStringEnd = () => {
    const rest = src.slice(i + 1, i + 80);
    const m = /^\s*([,}\]:])/.exec(rest);
    if (!m) return false;
    if (m[1] !== ",") return true;
    return /^\s*,\s*(?:'|"|\{|\[|-?\d|true\b|false\b|null\b|None\b|True\b|False\b)/.test(
      rest,
    );
  };
  const readString = () => {
    const quote = src[i++];
    let s = "";
    while (i < src.length && !(src[i] === quote && isStringEnd())) {
      if (src[i] === "\\") {
        i++;
        const e = src[i++];
        if (e === "n") s += "\n";
        else if (e === "t") s += "\t";
        else if (e === "r") s += "\r";
        else if (e === "x") {
          s += String.fromCharCode(parseInt(src.slice(i, i + 2), 16));
          i += 2;
        } else if (e === "u") {
          s += String.fromCharCode(parseInt(src.slice(i, i + 4), 16));
          i += 4;
        } else s += e; // \\ \' \" 등
      } else {
        s += src[i++];
      }
    }
    if (src[i] !== quote) throw new Error("글자가 닫히지 않았어요");
    i++;
    return s;
  };
  const readValue = (depth = 0) => {
    if (depth > 20) throw new Error("너무 깊어요");
    skipWs();
    const c = src[i];
    if (c === "{") {
      i++;
      const o = {};
      skipWs();
      if (src[i] === "}") {
        i++;
        return o;
      }
      for (;;) {
        skipWs();
        const k = readString();
        skipWs();
        if (src[i++] !== ":") throw new Error(": 가 없어요");
        o[k] = readValue(depth + 1);
        skipWs();
        if (src[i] === ",") {
          i++;
          continue;
        }
        if (src[i++] === "}") return o;
        throw new Error("객체가 닫히지 않았어요");
      }
    }
    if (c === "[") {
      i++;
      const a = [];
      skipWs();
      if (src[i] === "]") {
        i++;
        return a;
      }
      for (;;) {
        a.push(readValue(depth + 1));
        skipWs();
        if (src[i] === ",") {
          i++;
          continue;
        }
        if (src[i++] === "]") return a;
        throw new Error("배열이 닫히지 않았어요");
      }
    }
    if (c === "'" || c === '"') return readString();
    const m =
      /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|None|True|False)/.exec(
        src.slice(i, i + 40),
      );
    if (!m) throw new Error("알 수 없는 값이에요");
    i += m[0].length;
    const t = m[0];
    return t === "true" || t === "True"
      ? true
      : t === "false" || t === "False"
        ? false
        : t === "null" || t === "None"
          ? null
          : Number(t);
  };
  return readValue();
}

async function callMelonChart() {
  const res = await axios.post(
    MELON_MCP_URL,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_music_chart",
        arguments: { chart_type: "TOP_100", start: 1, size: MELON_TOP },
      },
    },
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "User-Agent": "OMNI-Bot (+https://github.com/felnut/OMNI-Bot)",
      },
      timeout: 10_000,
      responseType: "text",
      transformResponse: [(d) => d],
      maxContentLength: 2 * 1024 * 1024,
    },
  );
  // 응답은 "data: {...}" 형태의 서버 전송 이벤트
  const line = String(res.data)
    .split(/\r?\n/)
    .find((l) => l.startsWith("data:"));
  if (!line) throw new Error("응답 형식이 달라요");
  const rpc = JSON.parse(line.replace(/^data:\s*/, ""));
  if (rpc.error || rpc.result?.isError)
    throw new Error("멜론 서버가 오류를 돌려줬어요");
  const text =
    rpc.result?.structuredContent?.result ?? rpc.result?.content?.[0]?.text;
  return parseLooseLiteral(text).songs ?? [];
}

async function fetchMelon() {
  try {
    const songs = await callMelonChart();
    const tracks = songs
      .filter((s) => s?.song_name)
      .sort(
        (a, b) =>
          Number(a.rank?.current_rank ?? 999) -
          Number(b.rank?.current_rank ?? 999),
      )
      .slice(0, MELON_TOP)
      .map((s) => ({
        title: String(s.song_name),
        artist: (s.artists ?? [])
          .map((a) => a.artist_name)
          .filter(Boolean)
          .join(", "),
        url: null,
      }));
    if (!tracks.length) throw new Error("곡이 없어요");
    return tracks;
  } catch (e) {
    console.error(
      "🎧 멜론 차트 가져오기 실패:",
      e?.response?.status ?? e?.message,
    );
    throw new SourceError(
      "멜론 차트를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  }
}

// ---------- 유튜브·사운드클라우드 (yt-dlp) ----------
async function fetchViaYtdlp(source) {
  let entries;
  try {
    entries = await ytdlp.playlistEntries(source.url, MAX_PER_SOURCE);
  } catch (e) {
    console.error(
      `🎧 추천 목록 가져오기 실패(${source.label}):`,
      e.message.split("\n")[0],
    );
    throw new SourceError(
      `${source.label} 재생목록을 가져오지 못했어요. 공개 재생목록인지 확인해 주세요.`,
    );
  }
  return entries.map((e) => {
    // 유튜브 영상 제목에서 곡명과 가수를 나눈다 (사운드클라우드는 업로더가 곧 아티스트)
    const { title, artist } =
      source.kind === "youtube"
        ? splitYoutubeTitle(e.title, e.uploader)
        : { title: e.title, artist: e.uploader };
    return {
      title,
      artist,
      url:
        source.kind === "youtube" ? `https://youtu.be/${e.id}` : e.url || null,
    };
  });
}

// 제목 끝의 홍보 문구: "(Official Video)", "[M/V]", "Official Music Video", "MV" 등
const TITLE_NOISE_BRACKET =
  /\s*[\[(（【][^\])）】]*(?:official|m\/?v|music video|lyric|audio|visualizer|performance|live clip|video)[^\])）】]*[\])）】]\s*$/i;
const TITLE_NOISE_PLAIN =
  /\s+(?:official\s+)?(?:music\s+video|lyric\s+video|m\/v|mv|video|audio|visualizer)\s*$/i;
const QUOTES = "'\"‘’“”";

/**
 * 유튜브 영상 제목을 { title: 곡명, artist: 가수 }로 나눈다 (완벽하지 않은 추정).
 *  "가수 - 곡명 (Official Video)", "가수 '곡명' Official M/V"는 나누고, 그 외에는 채널 이름을 가수로 쓴다.
 */
function splitYoutubeTitle(rawTitle, channel) {
  let t = String(rawTitle ?? "").trim();
  for (let i = 0; i < 4; i++) {
    const next = t
      .replace(TITLE_NOISE_BRACKET, "")
      .replace(TITLE_NOISE_PLAIN, "")
      .trim();
    if (next === t) break;
    t = next;
  }
  const strip = (s) =>
    s.replace(new RegExp(`^[${QUOTES}\\s]+|[${QUOTES}\\s]+$`, "g"), "").trim();
  let title = t;
  let artist = String(channel ?? "")
    .replace(/\s*-\s*Topic$/i, "")
    .trim(); // 자동 생성 채널의 "- Topic" 꼬리표 제거
  const dash = t.indexOf(" - ");
  const quoted = t.match(new RegExp(`^(.+?)\\s+[${QUOTES}](.+)[${QUOTES}]$`));
  if (dash > 0) {
    artist = t.slice(0, dash).trim();
    title = t.slice(dash + 3).trim();
  } else if (quoted) {
    artist = quoted[1].trim();
    title = quoted[2].trim();
  }
  title = strip(title);
  return { title: title || String(rawTitle ?? "").trim(), artist };
}

const listCache = new Map(); // url -> { t, promise }

/**
 * 사이트 하나의 곡 목록 [{title, artist, url|null, source}] (1시간 동안 기억).
 * url이 없으면 "아티스트 제목"으로 유튜브에서 검색해 재생한다.
 */
function fetchTracks(source) {
  const hit = listCache.get(source.url);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.promise;
  const loader =
    source.kind === "spotify"
      ? fetchSpotify(source.url)
      : source.kind === "melon"
        ? fetchMelon()
        : fetchViaYtdlp(source);
  const promise = loader.then((tracks) =>
    tracks.map((t) => ({ ...t, source: source.label, kind: source.kind })),
  );
  listCache.set(source.url, { t: Date.now(), promise });
  promise.catch(() => listCache.delete(source.url)); // 실패는 기억하지 않음
  if (listCache.size > 50) listCache.delete(listCache.keys().next().value);
  return promise;
}

module.exports = {
  SourceError,
  parseSource,
  fetchTracks,
  spotifyConfigured,
  spotifyUsable,
  defaultSources,
  splitYoutubeTitle,
  parseLooseLiteral,
  SUPPORTED_TEXT,
};
