const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFile } = require("node:child_process");

// 유튜브 곡 캐시: 한 번 재생한 곡을 파일로 저장해 두고, 같은 곡은 yt-dlp 호출 없이 바로 재생한다.
// 파일은 봇 안의 로컬 전용(127.0.0.1) HTTP 서버로 제공하고 Lavalink가 http 소스로 읽는다.
const ytdlp = require("./ytdlp");
const DIR = path.join(__dirname, "../../music/cache");
const PORT = Number(process.env.MUSIC_CACHE_PORT) || 2334;
const BASE_URL = process.env.MUSIC_CACHE_BASE_URL || `http://127.0.0.1:${PORT}`;
const MAX_BYTES = (process.env.MUSIC_CACHE_MAX_MB === undefined ? 2048 : Number(process.env.MUSIC_CACHE_MAX_MB)) * 1024 * 1024;
const MAX_DURATION_S = (Number(process.env.MUSIC_CACHE_MAX_MINUTES) || 30) * 60; // 이보다 긴 영상은 저장하지 않음
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const FILE_RE = /^[A-Za-z0-9_-]{11}\.(webm|m4a|opus|ogg|mp4|mp3)$/;
const MIME = { webm: "audio/webm", m4a: "audio/mp4", mp4: "audio/mp4", opus: "audio/ogg", ogg: "audio/ogg", mp3: "audio/mpeg" };

const enabled = MAX_BYTES > 0;
const inflight = new Set(); // 다운로드 중인 영상 ID
let searchIndex = null; // 검색어 → 영상 ID

const metaPath = (id) => path.join(DIR, `${id}.json`);
const indexPath = () => path.join(DIR, "search-index.json");

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

/** 유튜브 URL에서 영상 ID 추출 (없으면 null) */
function extractVideoId(url) {
  const host = url.hostname.toLowerCase();
  let id = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else {
    id = url.searchParams.get("v");
    if (!id) {
      const m = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?]+)/);
      if (m) id = m[1];
    }
  }
  return id && ID_RE.test(id) ? id : null;
}

function readMeta(id) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(id), "utf8"));
  } catch {
    return null;
  }
}

/** 캐시된 곡 조회. 파일이 온전하면 { file, url, meta }, 아니면 null */
function find(id) {
  if (!enabled || !ID_RE.test(id)) return null;
  const meta = readMeta(id);
  if (!meta || !FILE_RE.test(meta.file || "")) return null;
  try {
    const st = fs.statSync(path.join(DIR, meta.file));
    if (!st.isFile() || st.size === 0) return null;
  } catch {
    return null;
  }
  meta.lastUsed = Date.now();
  try {
    fs.writeFileSync(metaPath(id), JSON.stringify(meta));
  } catch {
    /* 사용 시각 갱신 실패는 무시 */
  }
  return { file: meta.file, url: `${BASE_URL}/${meta.file}`, meta };
}

/** 캐시 항목 삭제 (파일이 깨졌을 때) */
function remove(id) {
  if (!ID_RE.test(id)) return;
  const meta = readMeta(id);
  try {
    if (meta && FILE_RE.test(meta.file || "")) fs.rmSync(path.join(DIR, meta.file), { force: true });
    fs.rmSync(metaPath(id), { force: true });
  } catch {
    /* 무시 */
  }
}

// ---- 검색어 → 영상 ID 색인 ----
const normalizeQuery = (q) => q.trim().toLowerCase().replace(/\s+/g, " ");

function loadIndex() {
  if (searchIndex) return searchIndex;
  try {
    searchIndex = JSON.parse(fs.readFileSync(indexPath(), "utf8"));
  } catch {
    searchIndex = {};
  }
  return searchIndex;
}

function lookupSearch(query) {
  if (!enabled) return null;
  const id = loadIndex()[normalizeQuery(query)];
  return id && ID_RE.test(id) ? id : null;
}

function saveSearch(query, id) {
  if (!enabled || !ID_RE.test(id)) return;
  const idx = loadIndex();
  idx[normalizeQuery(query)] = id;
  try {
    ensureDir();
    fs.writeFileSync(indexPath(), JSON.stringify(idx));
  } catch (e) {
    console.error("🎵 캐시 색인 저장 실패:", e.message);
  }
}

// ---- 저장 ----
/** 곡을 백그라운드로 내려받아 저장한다 (재생을 막지 않음). info: yt-dlp 메타데이터 */
function store(info, attempt = 1) {
  if (!enabled || !info || !ID_RE.test(info.id || "")) return;
  const id = info.id;
  if (info.is_live || (info.duration && info.duration > MAX_DURATION_S)) return;
  if (inflight.has(id) || find(id)) return;
  inflight.add(id);
  ensureDir();

  const url = info.webpage_url || `https://www.youtube.com/watch?v=${id}`;
  const cmd = ytdlp.command();
  execFile(
    cmd.file,
    [
      ...cmd.prefix,
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      "-f",
      "bestaudio",
      "--js-runtimes",
      "node",
      "-o",
      path.join(DIR, `${id}.%(ext)s`),
      url,
    ],
    { timeout: DOWNLOAD_TIMEOUT_MS, windowsHide: true },
    (err, _stdout, stderr) => {
      inflight.delete(id);
      // 유튜브가 일시적으로 거부(403 등)할 수 있어 한 번만 재시도
      if (err && attempt < 2) {
        for (const f of fs.readdirSync(DIR)) if (f.startsWith(`${id}.`) && f !== `${id}.json`) fs.rmSync(path.join(DIR, f), { force: true });
        setTimeout(() => store(info, attempt + 1), 5000);
        return;
      }
      const file = fs.readdirSync(DIR).find((f) => f.startsWith(`${id}.`) && FILE_RE.test(f));
      if (err || !file) {
        console.error("🎵 곡 저장 실패:", id, (stderr || err?.message || "").toString().split("\n").slice(-2).join(" ").slice(0, 200));
        // 남은 조각 파일 정리
        for (const f of fs.readdirSync(DIR)) if (f.startsWith(`${id}.`) && f !== `${id}.json`) fs.rmSync(path.join(DIR, f), { force: true });
        return;
      }
      const size = fs.statSync(path.join(DIR, file)).size;
      fs.writeFileSync(
        metaPath(id),
        JSON.stringify({
          id,
          file,
          size,
          title: info.title,
          uploader: info.uploader,
          thumbnail: info.thumbnail,
          webpage_url: info.webpage_url,
          duration: info.duration,
          savedAt: Date.now(),
          lastUsed: Date.now(),
        }),
      );
      console.log(`🎵 곡 저장 완료: ${info.title} (${(size / 1048576).toFixed(1)}MB)`);
      evict();
    },
  );
}

/** 총 용량이 상한을 넘으면 오래 안 쓴 곡부터 삭제 (상한의 90%까지) */
function evict() {
  if (!enabled) return;
  try {
    const items = fs
      .readdirSync(DIR)
      .filter((f) => f.endsWith(".json") && f !== "search-index.json")
      .map((f) => readMeta(f.slice(0, -5)))
      .filter(Boolean);
    let total = items.reduce((s, m) => s + (m.size || 0), 0);
    if (total <= MAX_BYTES) return;
    items.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
    for (const m of items) {
      if (total <= MAX_BYTES * 0.9) break;
      remove(m.id);
      total -= m.size || 0;
      console.log(`🎵 캐시 정리: ${m.title}`);
    }
  } catch (e) {
    console.error("🎵 캐시 정리 실패:", e.message);
  }
}

// ---- 로컬 파일 서버 (Lavalink가 읽음) ----
function startCacheServer() {
  if (!enabled) {
    console.log("🎵 곡 캐시 꺼짐 (MUSIC_CACHE_MAX_MB=0)");
    return;
  }
  ensureDir();
  evict();
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    const name = decodeURIComponent((req.url || "").split("?")[0].slice(1));
    if (!FILE_RE.test(name)) {
      res.writeHead(404).end();
      return;
    }
    const file = path.join(DIR, name);
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      res.writeHead(404).end();
      return;
    }
    const headers = {
      "Content-Type": MIME[name.split(".").pop()] || "application/octet-stream",
      "Accept-Ranges": "bytes",
    };
    let start = 0;
    let end = st.size - 1;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (range) {
      if (range[1] !== "") start = Number(range[1]);
      if (range[2] !== "") end = Math.min(Number(range[2]), st.size - 1);
      if (range[1] === "" && range[2] !== "") {
        start = Math.max(0, st.size - Number(range[2]));
        end = st.size - 1;
      }
      if (start > end || start >= st.size) {
        res.writeHead(416, { "Content-Range": `bytes */${st.size}` }).end();
        return;
      }
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 });
    } else {
      res.writeHead(200, { ...headers, "Content-Length": st.size });
    }
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file, { start, end }).on("error", () => res.destroy()).pipe(res);
  });
  server.on("error", (e) => console.error(`🎵 캐시 서버 오류(포트 ${PORT}):`, e.message));
  server.listen(PORT, "127.0.0.1", () => console.log(`🎵 곡 캐시 서버: 127.0.0.1:${PORT} (최대 ${Math.round(MAX_BYTES / 1048576)}MB)`));
}

module.exports = { enabled, extractVideoId, find, remove, lookupSearch, saveSearch, store, startCacheServer };
