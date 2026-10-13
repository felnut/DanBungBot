const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");

// yt-dlp 실행기.
// 1순위: 가상환경의 파이썬에 yt-dlp를 설치해 두고 상시 워커(music/ytdlp_worker.py)로 요청을 처리한다.
//        (yt-dlp.exe는 실행할 때마다 약 3초의 시작 비용이 들기 때문)
// 2순위: 가상환경이 없으면 yt-dlp 실행 파일을 요청마다 실행한다.
const ROOT = path.join(__dirname, "../..");
const VENV_PY =
  process.env.YTDLP_PYTHON ||
  path.join(ROOT, "music/tools/ytdlp-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const WORKER_SCRIPT = path.join(ROOT, "music/ytdlp_worker.py");
const EXE = process.env.YTDLP_PATH || "yt-dlp";

const REQUEST_TIMEOUT_MS = 30_000;
const UPDATE_TIMEOUT_MS = 180_000;
const FIELDS = "%(.{id,title,uploader,thumbnail,webpage_url,url,duration,is_live})j";

const useWorker = process.env.YTDLP_USE_WORKER !== "0" && fs.existsSync(VENV_PY) && fs.existsSync(WORKER_SCRIPT);

let child = null;
let readyPromise = null;
let buffer = "";
let nextId = 1;
const pending = new Map(); // id -> { resolve, reject, timer }

function failAll(message) {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(message));
  }
  pending.clear();
}

function onLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.ready) return;
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  clearTimeout(p.timer);
  if (msg.ok) p.resolve(msg.info ?? msg.results);
  else p.reject(new Error(msg.error || "yt-dlp 오류"));
}

/** 워커 프로세스를 (필요하면) 띄우고, 준비될 때까지 기다린다 */
function ensureWorker() {
  if (child && readyPromise) return readyPromise;
  buffer = "";
  const proc = spawn(VENV_PY, [WORKER_SCRIPT], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child = proc;
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  readyPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("워커 시작 시간 초과")), 20_000);
    proc.stdout.on("data", (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (line.includes('"ready"')) {
          clearTimeout(timer);
          try {
            console.log(`🎵 yt-dlp 워커 준비 완료 (v${JSON.parse(line).version})`);
          } catch {
            /* 버전 출력 실패는 무시 */
          }
          resolve();
        }
        onLine(line);
      }
    });
    proc.once("error", (e) => reject(e));
    proc.once("exit", () => reject(new Error("워커가 시작 중 종료됨")));
  });
  readyPromise.catch(() => {});
  proc.stderr.on("data", (d) => console.error("🎵 yt-dlp 워커 stderr:", d.toString().trim().slice(0, 300)));
  proc.on("exit", (code) => {
    if (child === proc) {
      child = null;
      readyPromise = null;
    }
    failAll(`yt-dlp 워커가 종료되었습니다 (code ${code})`);
  });
  return readyPromise;
}

function stopWorker() {
  if (!child) return;
  const proc = child;
  child = null;
  readyPromise = null;
  proc.stdin.end();
  setTimeout(() => proc.kill(), 1000).unref();
}

async function extractViaWorker(target) {
  await ensureWorker();
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("yt-dlp 응답 시간 초과"));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, target }) + "\n");
  });
}

function searchViaWorker(query, count) {
  return ensureWorker().then(
    () =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("yt-dlp 검색 시간 초과"));
        }, REQUEST_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ id, op: "search", query, count }) + String.fromCharCode(10));
      }),
  );
}

function searchViaExe(query, count) {
  return new Promise((resolve, reject) => {
    execFile(
      EXE,
      ["--flat-playlist", "--no-warnings", "--print", "%(.{id,title,uploader,channel,duration,live_status})j", `ytsearch${count + 5}:${query}`],
      { timeout: REQUEST_TIMEOUT_MS, windowsHide: true, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).toString()));
        const out = [];
        for (const line of stdout.split(String.fromCharCode(10))) {
          try {
            const e = JSON.parse(line);
            if (e.id && e.id.length === 11 && e.live_status !== "is_upcoming") {
              out.push({ id: e.id, title: e.title, uploader: e.channel || e.uploader, duration: e.duration, is_live: e.live_status === "is_live" });
            }
          } catch {
            /* 빈 줄 등 무시 */
          }
          if (out.length >= count) break;
        }
        resolve(out);
      },
    );
  });
}

function extractViaExe(target) {
  return new Promise((resolve, reject) => {
    execFile(
      EXE,
      ["--no-playlist", "--no-warnings", "-f", "bestaudio", "--js-runtimes", "node", "--print", FIELDS, target],
      { timeout: REQUEST_TIMEOUT_MS, windowsHide: true, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).toString()));
        try {
          resolve(JSON.parse(stdout.trim().split("\n")[0]));
        } catch {
          reject(new Error("yt-dlp 응답을 해석하지 못했습니다"));
        }
      },
    );
  });
}

// 추출 결과 메모: 자동완성 단계에서 미리 추출해 둔 결과를 실제 재생 때 바로 쓰기 위함.
// 스트림 주소는 몇 시간 뒤 만료되므로 짧게(10분) 보관한다. 진행 중인 요청도 공유해 중복 실행을 막는다.
const MEMO_TTL_MS = 10 * 60 * 1000;
const MEMO_MAX = 100;
const memo = new Map(); // target -> { t, promise }

/** 재생용 직접 주소와 메타데이터를 가져온다 (영상은 받지 않음). 실패하면 Error(상세 메시지) */
function extract(target) {
  const hit = memo.get(target);
  if (hit && Date.now() - hit.t < MEMO_TTL_MS) return hit.promise;

  const promise = useWorker ? extractViaWorker(target) : extractViaExe(target);
  memo.set(target, { t: Date.now(), promise });
  promise.catch(() => memo.delete(target)); // 실패는 기억하지 않음
  if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value); // 가장 오래된 것부터 제거
  return promise;
}

const LONG_VIDEO_SEC = 12 * 60;
const searchMemo = new Map(); // "개수:검색어" -> { t, promise }

/** 유튜브 영상 검색 (채널·재생목록 제외). [{id,title,uploader,duration(초),is_live}] 결과는 10분간 기억 */
function search(query, count = 5) {
  const key = `${count}:${query.trim().toLowerCase()}`;
  const hit = searchMemo.get(key);
  if (hit && Date.now() - hit.t < MEMO_TTL_MS) return hit.promise;
  // 12분을 넘는 영상(모음·믹스·풀 앨범)은 곡 단위 영상 뒤로 미룬다. 곡이 부족하면 그대로 포함된다.
  // 거르고도 count개가 남도록 여유 있게 가져온다.
  const pool = Math.min(count * 2, 10);
  const fetchPool = useWorker ? searchViaWorker(query, pool) : searchViaExe(query, pool);
  const promise = fetchPool.then((all) => {
    const isLong = (r) => !r.is_live && r.duration && r.duration > LONG_VIDEO_SEC;
    return [...all.filter((r) => !isLong(r)), ...all.filter(isLong)].slice(0, count);
  });
  searchMemo.set(key, { t: Date.now(), promise });
  promise.catch(() => searchMemo.delete(key));
  if (searchMemo.size > MEMO_MAX) searchMemo.delete(searchMemo.keys().next().value);
  return promise;
}

/** 영상 파일 다운로드 등 CLI로 실행할 때의 [실행파일, 앞쪽 인자] */
function command() {
  return useWorker ? { file: VENV_PY, prefix: ["-m", "yt_dlp"] } : { file: EXE, prefix: [] };
}

/** yt-dlp를 최신 버전으로 업데이트. 성공하면 true */
function update() {
  return new Promise((resolve) => {
    const [file, args] = useWorker ? [VENV_PY, ["-m", "pip", "install", "-U", "-q", "yt-dlp"]] : [EXE, ["-U"]];
    execFile(file, args, { timeout: UPDATE_TIMEOUT_MS, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        console.error("🎵 yt-dlp 업데이트 실패:", (stderr || err.message).toString().slice(0, 300));
        return resolve(false);
      }
      console.log("🎵 yt-dlp 업데이트 완료", useWorker ? "(워커를 재시작합니다)" : stdout.toString().trim().split("\n").slice(-1)[0]);
      stopWorker(); // 새 버전으로 다시 뜨도록 다음 요청 때 재시작
      resolve(true);
    });
  });
}

/** 봇 시작 시 워커를 미리 띄워 첫 요청 지연을 없앤다 */
function warmup() {
  if (!useWorker) {
    console.log("🎵 yt-dlp 워커 없음 → 실행 파일 방식 사용 (느림). music/tools/ytdlp-venv 설치를 권장합니다.");
    return;
  }
  ensureWorker().catch((e) => console.error("🎵 yt-dlp 워커 시작 실패:", e.message));
}

process.on("exit", () => child?.kill());

module.exports = { extract, search, command, update, warmup, useWorker };
