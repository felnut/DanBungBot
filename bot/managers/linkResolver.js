const { execFile } = require("node:child_process");

const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
const YTDLP_TIMEOUT_MS = 30_000;

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

/** yt-dlp로 재생용 직접 주소와 메타데이터를 가져온다 (영상은 받지 않음) */
function ytdlp(target) {
  return new Promise((resolve, reject) => {
    execFile(
      YTDLP,
      [
        "--no-playlist",
        "--no-warnings",
        "-f",
        "bestaudio",
        "--js-runtimes",
        "node",
        "--print",
        "%(.{title,uploader,thumbnail,webpage_url,url})j",
        target,
      ],
      { timeout: YTDLP_TIMEOUT_MS, windowsHide: true, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          console.error("🎵 yt-dlp 실패:", (stderr || err.message).toString().split("\n").slice(-3).join(" ").slice(0, 300));
          return reject(new ResolveError("유튜브에서 곡 정보를 가져오지 못했어요. 잠시 후 다시 시도해 주세요."));
        }
        try {
          resolve(JSON.parse(stdout.trim().split("\n")[0]));
        } catch {
          reject(new ResolveError("유튜브 응답을 해석하지 못했어요."));
        }
      },
    );
  });
}

/**
 * 사용자 입력을 Lavalink에 넘길 식별자로 변환한다.
 * @param {string} input 검색어 또는 URL
 * @param {"soundcloud"|"youtube"} source 검색어일 때 사용할 소스
 * @returns {Promise<{identifier: string, meta?: object}>}
 */
async function resolveInput(input, source = "soundcloud") {
  const text = input.trim();
  const url = parseUrl(text);

  if (!url) {
    // http(s)가 아닌 주소(file:// 등)는 검색어로도 넘기지 않음
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
      throw new ResolveError("지원하지 않는 링크예요. (유튜브, 사운드클라우드, 밴드캠프, 트위치, 비메오)");
    }
    if (source === "youtube") {
      const info = await ytdlp(`ytsearch1:${text}`);
      return { identifier: info.url, meta: info };
    }
    return { identifier: text }; // 기본: Lavalink 기본 검색(사운드클라우드)
  }

  const host = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.includes(host)) {
    if (url.pathname.startsWith("/playlist")) {
      throw new ResolveError("유튜브 재생목록 링크는 아직 지원하지 않아요. 곡 링크를 넣어 주세요.");
    }
    const info = await ytdlp(text);
    return { identifier: info.url, meta: info };
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
