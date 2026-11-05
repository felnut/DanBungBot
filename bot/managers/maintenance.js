const fs = require("node:fs");
const path = require("node:path");
const db = require("../../Database");

// 개인정보 처리방침 1항의 보유 기간을 지키기 위한 정기 정리 작업
const INACTIVE_MS = 365 * 24 * 60 * 60 * 1000; // 마지막 이용 후 12개월
const LOG_KEEP_MS = 30 * 24 * 60 * 60 * 1000; // 로그 30일
const TRANSFER_LOG_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const LOG_DIRS = [path.join(__dirname, "../../music/logs")];

/** 마지막 이용 후 12개월이 지난 이용자의 데이터를 삭제한다 (보유 주식은 FK로 함께 삭제) */
function purgeInactiveUsers(now = Date.now()) {
  const cutoff = now - INACTIVE_MS;
  const ids = db
    .prepare(
      "SELECT user_id FROM user WHERE last_active > 0 AND last_active < ?",
    )
    .all(cutoff)
    .map((r) => r.user_id);
  if (!ids.length) return 0;
  db.transaction(() => {
    for (const id of ids) {
      db.prepare("DELETE FROM baseball_games WHERE user_id = ?").run(id);
      db.prepare(
        "DELETE FROM transfer_log WHERE sender_id = ? OR receiver_id = ?",
      ).run(id, id);
      db.prepare("DELETE FROM dday WHERE created_by = ?").run(id);
      db.prepare("DELETE FROM user WHERE user_id = ?").run(id);
    }
  })();
  return ids.length;
}

/** 수정한 지 30일이 지난 로그 파일 삭제 */
function purgeOldLogs(now = Date.now()) {
  let n = 0;
  for (const dir of LOG_DIRS) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        const st = fs.statSync(file);
        if (
          st.isFile() &&
          /\.(log|gz)$/i.test(name) &&
          now - st.mtimeMs > LOG_KEEP_MS
        ) {
          fs.rmSync(file, { force: true });
          n += 1;
        }
      } catch {
        /* 사용 중인 파일 등은 다음 기회에 */
      }
    }
  }
  return n;
}

function runMaintenance() {
  try {
    const now = Date.now();
    db.prepare("DELETE FROM transfer_log WHERE created_at < ?").run(
      now - TRANSFER_LOG_KEEP_MS,
    );
    // 경고는 1년 뒤 삭제
    db.prepare("DELETE FROM warning WHERE created_at < ?").run(
      now - require("./moderation").WARNING_KEEP_MS,
    );
    // 날짜가 지난 지 30일이 넘은 D-day 삭제
    db.prepare("DELETE FROM dday WHERE date < ?").run(
      new Date(now + 9 * 3600e3 - 30 * 86400e3).toISOString().slice(0, 10),
    );
    // DM 메모·알림은 만든 지 12개월이 지나면 삭제 (이용자 등록 여부와 관계없이 쌓이므로 따로 정리)
    db.prepare("DELETE FROM memo WHERE created_at < ?").run(now - INACTIVE_MS);
    db.prepare("DELETE FROM reminder WHERE created_at < ?").run(
      now - INACTIVE_MS,
    );
    require("./progress").purgeOldQuests(now); // 지난 퀘스트 진행도 (60일 보관)
    const users = purgeInactiveUsers(now);
    const logs = purgeOldLogs(now);
    if (users || logs)
      console.log(
        `🧹 정리: 12개월 미이용 ${users}명, 오래된 로그 ${logs}개 삭제`,
      );
  } catch (e) {
    console.error("정기 정리 실패:", e);
  }
}

/** 시작 시 한 번, 이후 24시간마다 실행 */
function startMaintenance() {
  runMaintenance();
  setInterval(runMaintenance, 24 * 60 * 60 * 1000).unref();
}

module.exports = { startMaintenance, runMaintenance, purgeInactiveUsers };
