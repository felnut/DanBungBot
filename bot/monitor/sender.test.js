const test = require("node:test");
const assert = require("node:assert/strict");
const { Worker } = require("node:worker_threads");
const path = require("node:path");
const { Sender } = require("./sender");

function fixture(handler) {
  const calls = [];
  const logs = [];
  const sender = new Sender({
    baseUrl: "https://monitor.example",
    secret: "registration-secret",
    log: (message) => logs.push(message),
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      return handler(calls.length, url, options);
    },
  });
  return { sender, calls, logs };
}
const registered = () =>
  new Response(
    JSON.stringify({ generation: 12, instanceToken: "instance-secret" }),
  );

test("registration response loss keeps the same registration identity", async () => {
  const { sender, calls } = fixture((n) => {
    if (n === 1) throw new Error("lost response with secret");
    return n === 2 ? registered() : new Response(null, { status: 204 });
  });
  await sender.tick({});
  await sender.tick({});
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[2].headers.Authorization, "Bearer instance-secret");
  assert.equal(JSON.parse(calls[2].body).generation, 12);
  assert.equal(calls[2].redirect, "error");
});

test("heartbeat response loss retries identical bytes, next tick creates a fresh message", async () => {
  const { sender, calls } = fixture((n) => {
    if (n === 1) return registered();
    if (n === 2) throw new Error("response lost");
    return new Response(null, { status: 204 });
  });
  const checks = { discord: { checkSequence: 1, status: "ok" } };
  await sender.tick(checks);
  await sender.tick(checks);
  assert.equal(calls[1].body, calls[2].body);
  assert.equal(JSON.parse(calls[3].body).sequence, 2);
  assert.equal(JSON.parse(calls[3].body).checks.discord.checkSequence, 1);
});

test("revoked instance stops and never registers again", async () => {
  const { sender, calls, logs } = fixture((n) =>
    n === 1 ? registered() : new Response(null, { status: 410 }),
  );
  await sender.tick({});
  await sender.tick({});
  assert.equal(calls.length, 2);
  assert.equal(sender.stopped, true);
  assert.ok(logs.every((line) => !line.includes("secret")));
});

test("reject invalid registration data without sending a heartbeat", async () => {
  const { sender, calls } = fixture(
    () => new Response('{"generation":0,"instanceToken":"secret"}'),
  );
  await sender.tick({});
  assert.equal(calls.length, 1);
  assert.equal(sender.token, undefined);
});

test("overlapping ticks do not create extra requests", async () => {
  let release;
  const { sender, calls } = fixture((n) =>
    n === 1
      ? new Promise((resolve) => {
          release = () => resolve(registered());
        })
      : new Response(null, { status: 204 }),
  );
  const pending = sender.tick({});
  await sender.tick({});
  assert.equal(calls.length, 1);
  release();
  await pending;
  assert.equal(calls.length, 2);
});

test("429 waits until next tick and does not immediately retry", async () => {
  const { sender, calls } = fixture((n) =>
    n === 1 ? registered() : new Response(null, { status: 429 }),
  );
  await sender.tick({});
  assert.equal(calls.length, 2);
});

test("credentials cannot be sent to HTTP or a credential-bearing URL", () => {
  for (const baseUrl of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/path",
  ]) {
    assert.throws(() => new Sender({ baseUrl, secret: "secret" }));
  }
});

test("database probe reads a fixture without loading or migrating the bot database", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omni-monitor-"));
  const file = path.join(directory, "test.db");
  try {
    const Database = require("better-sqlite3");
    const db = new Database(file);
    db.exec('CREATE TABLE "user" (user_id TEXT PRIMARY KEY)');
    db.close();
    const before = fs.readFileSync(file);
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, "databaseWorker.js"), {
        workerData: { path: file },
      });
      let result;
      worker.once("message", (message) => {
        result = message;
      });
      worker.once("error", reject);
      worker.once("exit", (code) =>
        code ? reject(new Error(`Worker exit ${code}`)) : resolve(result),
      );
    });
    assert.deepEqual(result, { status: "ok" });
    assert.deepEqual(fs.readFileSync(file), before);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
