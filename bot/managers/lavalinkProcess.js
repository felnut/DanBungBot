// 봇을 실행하면 같은 컴퓨터의 Lavalink(음악 서버)도 함께 실행한다.
// - 이미 포트가 열려 있으면(직접 켜 둔 경우) 새로 켜지 않고 그대로 쓴다.
// - Lavalink가 예기치 않게 종료되면 잠시 뒤 다시 실행한다.
// - 봇이 정상 종료되면 Lavalink도 함께 끈다. (LAVALINK_AUTOSTART=0 이면 이 기능을 끈다)
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "../../music");
const JAR = path.join(DIR, "Lavalink.jar");
const CONFIG = path.join(DIR, "application.yml");
const LOG = path.join(DIR, "run.log");
const ERR_LOG = path.join(DIR, "run.err.log");
const LOG_MAX_BYTES = 5 * 1024 * 1024; // 로그 파일이 이보다 커지면 새로 시작한다
const STABLE_MS = 60_000; // 이만큼 살아 있었으면 정상 실행으로 보고 실패 횟수를 지운다

let child = null;
let stopping = false;
let failures = 0;
let hooksInstalled = false;

const isLocalHost = (h) =>
  ["127.0.0.1", "localhost", "::1"].includes(String(h).toLowerCase());

/** 포트가 열려 있는지 (1초 안에 연결되면 열려 있음) */
function isPortOpen(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

const openLog = (file) => {
  let flags = "a";
  try {
    if (fs.statSync(file).size > LOG_MAX_BYTES) flags = "w";
  } catch {
    /* 파일이 아직 없으면 새로 만든다 */
  }
  return fs.openSync(file, flags);
};

function launch() {
  const out = openLog(LOG);
  const err = openLog(ERR_LOG);
  const startedAt = Date.now();
  try {
    child = spawn("java", ["-Xmx512m", "-jar", "Lavalink.jar"], {
      cwd: DIR,
      stdio: ["ignore", out, err],
      windowsHide: true,
    });
  } finally {
    fs.closeSync(out);
    fs.closeSync(err);
  }
  console.log(
    `🎵 Lavalink를 실행했어요 (PID ${child.pid}). 준비되는 데 10~30초 걸려요.`,
  );

  child.on("error", (e) => {
    child = null;
    stopping = true; // 실행 파일 자체가 없으면 다시 시도해도 소용없다
    console.error(
      "🎵 Lavalink 실행 실패:",
      e.code === "ENOENT"
        ? "java를 찾을 수 없어요. Java 17 이상을 설치해 주세요."
        : e.message,
    );
  });
  child.on("exit", (code, signal) => {
    child = null;
    if (stopping) return;
    failures = Date.now() - startedAt > STABLE_MS ? 1 : failures + 1;
    const delay = Math.min(5000 * 2 ** Math.min(failures - 1, 4), 60_000); // 5초 → 10초 → … 최대 60초
    console.warn(
      `🎵 Lavalink가 종료됐어요 (${signal ?? `코드 ${code}`}). ${delay / 1000}초 뒤 다시 실행합니다.`,
    );
    setTimeout(() => {
      if (!stopping && !child) launch();
    }, delay);
  });
}

/** 봇이 정상 종료될 때 Lavalink도 함께 끈다 (작업 관리자 등으로 강제 종료하면 Lavalink는 남아 있고, 다음 실행 때 그대로 이어 쓴다) */
function stopLavalink() {
  stopping = true;
  if (child) {
    try {
      child.kill();
    } catch {
      /* 이미 종료됨 */
    }
  }
}

/** Lavalink를 실행한다 (이미 실행 중이거나 자동 실행을 끈 경우에는 아무것도 하지 않는다) */
async function startLavalink() {
  if (process.env.LAVALINK_AUTOSTART === "0") {
    console.log(
      "🎵 LAVALINK_AUTOSTART=0 이라 Lavalink를 자동으로 실행하지 않아요.",
    );
    return;
  }
  const host = process.env.LAVALINK_HOST || "127.0.0.1";
  const port = Number(process.env.LAVALINK_PORT) || 2333;
  if (!isLocalHost(host)) return; // 다른 컴퓨터의 Lavalink는 여기서 켤 수 없다
  const pw = process.env.LAVALINK_PASSWORD;
  if (!pw || pw === "CHANGE_ME") return; // 음악 기능이 꺼져 있다 (createMusicManager가 안내)
  if (!fs.existsSync(JAR) || !fs.existsSync(CONFIG)) {
    console.warn(
      "🎵 music/Lavalink.jar 또는 music/application.yml이 없어 Lavalink를 실행하지 못해요. README의 '음악 재생' 설정을 확인해 주세요.",
    );
    return;
  }
  if (await isPortOpen(port, host)) {
    console.log(
      `🎵 Lavalink가 이미 실행 중이에요 (${host}:${port}). 그대로 이어서 사용합니다.`,
    );
    return;
  }
  if (!hooksInstalled) {
    hooksInstalled = true;
    process.on("exit", stopLavalink);
    for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
      process.on(sig, () => {
        stopLavalink();
        process.exit(0);
      });
    }
  }
  stopping = false;
  failures = 0;
  launch();
}

module.exports = { startLavalink, stopLavalink };
