const path = require("node:path");
const { fork } = require("node:child_process");

function startMonitor(client) {
  if (process.env.MONITOR_ENABLED !== "1") return;
  try {
    const url = new URL(process.env.MONITOR_BASE_URL);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !process.env.MONITOR_REGISTER_SECRET ||
      /[\r\n]/.test(process.env.MONITOR_REGISTER_SECRET)
    )
      throw new Error();
  } catch {
    console.warn(
      "[monitor] HTTPS 주소·등록 비밀값 설정 오류: 감시 송신 비활성",
    );
    return;
  }
  // Only pass credentials needed by the child, never the Discord or Statuspage token.
  const env = {};
  for (const key of [
    "SystemRoot",
    "SYSTEMROOT",
    "PATH",
    "Path",
    "TEMP",
    "TMP",
    "MONITOR_BASE_URL",
    "MONITOR_REGISTER_SECRET",
    "LAVALINK_HOST",
    "LAVALINK_PORT",
    "LAVALINK_PASSWORD",
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  let child;
  try {
    child = fork(path.join(__dirname, "../monitor/process.js"), [], {
      env,
      execArgv: [],
      windowsHide: true,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
  } catch {
    console.warn("[monitor] 감시 프로세스 시작 실패");
    return;
  }
  let pending = false;
  const publish = () => {
    if (!child.connected || pending) return;
    pending = true;
    child.send(
      {
        type: "monitor:state",
        ready: client.isReady(),
        latencyMs: client.ws.ping,
      },
      () => {
        pending = false;
      },
    );
  };
  publish();
  const timer = setInterval(publish, 10_000);
  child.on("error", () => console.warn("[monitor] 감시 프로세스 오류"));
  child.once("exit", () => {
    clearInterval(timer);
    // A restart would register a new generation; require an intentional bot restart instead.
    console.warn("[monitor] 감시 프로세스 종료: 봇 재시작 전까지 송신 중지");
  });
  process.once("exit", () => child.kill());
}

module.exports = { startMonitor };
