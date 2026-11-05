const { parentPort, workerData } = require("node:worker_threads");

let db;
try {
  const Database = require("better-sqlite3");
  db = new Database(workerData.path, {
    readonly: true,
    fileMustExist: true,
    timeout: 2000,
  });
  db.prepare('SELECT user_id FROM "user" LIMIT 1').get();
  parentPort.postMessage({ status: "ok" });
} catch (error) {
  parentPort.postMessage({
    status: "down",
    code: ["SQLITE_BUSY", "SQLITE_LOCKED"].includes(error.code)
      ? "DB_TIMEOUT"
      : "DB_READ_FAILED",
  });
} finally {
  if (db) db.close();
}
