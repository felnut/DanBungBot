const db = require("../../Database");

const CHECK_MS = 15 * 1000;
const stmtDue = db.prepare(
  "SELECT id, user_id, message, created_at FROM reminder WHERE due_at <= ? ORDER BY due_at ASC LIMIT 50",
);
const stmtDelete = db.prepare("DELETE FROM reminder WHERE id = ?");

/** 시각이 된 알림을 DM으로 보내고 지운다. DM이 막혀 있어도 한 번만 시도하고 지운다 */
async function sendDue(client, now = Date.now()) {
  const rows = stmtDue.all(now);
  for (const r of rows) {
    stmtDelete.run(r.id);
    try {
      const user = await client.users.fetch(r.user_id);
      await user.send(
        `⏰ **알림**이에요!\n${r.message}\n-# <t:${Math.floor(r.created_at / 1000)}:R>에 맞춰 둔 알림이에요`,
      );
    } catch (e) {
      console.warn(
        `알림 DM 전송 실패 (알림 #${r.id}):`,
        e?.code ?? e?.message ?? e,
      );
    }
  }
  return rows.length;
}

function startReminders(client) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sendDue(client);
    } catch (e) {
      console.error("알림 확인 실패:", e);
    } finally {
      running = false;
    }
  };
  tick(); // 꺼져 있는 동안 지난 알림도 켜자마자 보낸다
  setInterval(tick, CHECK_MS).unref();
}

module.exports = { startReminders, sendDue };
