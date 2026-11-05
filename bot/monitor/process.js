const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { Sender } = require("./sender");

const INTERVAL = 60_000;
const CHECK_TIMEOUT = 5000;
const checks = {};
const counters = {};
let botState;
let botReceivedAt = 0;
let dbWorker;
let dbBusy = false;
let musicBusy = false;

function record(name, result) {
  checks[name] = {
    ...result,
    checkSequence: (counters[name] = (counters[name] || 0) + 1),
    lastCheckedAt: new Date().toISOString(),
  };
}

process.on("message", (message) => {
  if (message?.type !== "monitor:state") return;
  botState = message;
  botReceivedAt = Date.now();
});
process.on("disconnect", () => process.exit(0));

function checkDiscord() {
  if (!botState || Date.now() - botReceivedAt > 30_000) {
    record("discord", { status: "down", code: "BOT_STATE_TIMEOUT" });
  } else if (!botState.ready) {
    record("discord", { status: "down", code: "DISCORD_NOT_READY" });
  } else if (!Number.isFinite(botState.latencyMs) || botState.latencyMs < 0) {
    record("discord", { status: "unknown", code: "DISCORD_LATENCY_UNKNOWN" });
  } else {
    record("discord", {
      status: botState.latencyMs > 1000 ? "degraded" : "ok",
      latencyMs: Math.round(botState.latencyMs),
      ...(botState.latencyMs > 1000 ? { code: "DISCORD_HIGH_LATENCY" } : {}),
    });
  }
}

function checkDatabase() {
  if (dbBusy) return;
  dbBusy = true;
  let settled = false;
  let timer;
  const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    record("database", result);
    // Keep the guard until termination completes; never overlap workers.
    const worker = dbWorker;
    dbWorker = null;
    Promise.resolve(worker?.terminate())
      .catch(() => {})
      .finally(() => {
        dbBusy = false;
      });
  };
  try {
    dbWorker = new Worker(path.join(__dirname, "databaseWorker.js"), {
      workerData: { path: path.resolve(__dirname, "../../game.db") },
    });
    timer = setTimeout(
      () => finish({ status: "down", code: "DB_TIMEOUT" }),
      CHECK_TIMEOUT,
    );
    dbWorker.once("message", finish);
    dbWorker.once("error", () =>
      finish({ status: "down", code: "DB_READ_FAILED" }),
    );
    dbWorker.once("exit", () =>
      finish({ status: "down", code: "DB_READ_FAILED" }),
    );
  } catch {
    finish({ status: "down", code: "DB_READ_FAILED" });
  }
}

async function checkMusic() {
  if (musicBusy) return;
  const password = process.env.LAVALINK_PASSWORD;
  if (!password || password === "CHANGE_ME") {
    record("music", { status: "unknown", code: "MUSIC_NOT_CONFIGURED" });
    return;
  }
  musicBusy = true;
  try {
    const url = new URL("http://127.0.0.1:2333/v4/info");
    url.hostname = process.env.LAVALINK_HOST || "127.0.0.1";
    url.port = process.env.LAVALINK_PORT || "2333";
    const response = await fetch(url, {
      headers: { Authorization: password },
      redirect: "error",
      signal: AbortSignal.timeout(CHECK_TIMEOUT),
    });
    await response.body?.cancel();
    record(
      "music",
      response.ok
        ? { status: "ok" }
        : { status: "down", code: "MUSIC_HTTP_ERROR" },
    );
  } catch {
    record("music", { status: "down", code: "MUSIC_UNREACHABLE" });
  } finally {
    musicBusy = false;
  }
}

const sender = new Sender({
  baseUrl: process.env.MONITOR_BASE_URL,
  secret: process.env.MONITOR_REGISTER_SECRET,
});
function runChecks() {
  checkDiscord();
  checkDatabase();
  void checkMusic();
}
runChecks();
setInterval(runChecks, INTERVAL);
// Snapshot the results: in-flight retries must not change their payload.
const send = () =>
  sender.tick(structuredClone(checks)).catch(() => {
    console.warn("[monitor] 송신 처리 실패 (다음 주기에 재시도)");
  });
setTimeout(send, CHECK_TIMEOUT + 500);
setInterval(send, INTERVAL);
