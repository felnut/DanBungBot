// 진행 중인 베팅 보관소: 여러 단계로 진행되는 게임(블랙잭 등)의 베팅액을 DB에 맡겨 두었다가 정산한다.
// 봇이 도중에 꺼져도 돈이 사라지지 않도록, 다음 시작 때 남은 베팅을 전액 돌려준다.
const db = require("../../Database");
const cache = require("../commands/utils/cache");

db.exec(`
  CREATE TABLE IF NOT EXISTS pending_bet (
    user_id TEXT PRIMARY KEY,
    amount INTEGER NOT NULL,
    game TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

const stmtHas = db.prepare("SELECT 1 FROM pending_bet WHERE user_id = ?");
const stmtTake = db.prepare(
  "UPDATE user SET money = money - ? WHERE user_id = ? AND money >= ?",
);
const stmtPut = db.prepare(
  "INSERT INTO pending_bet (user_id, amount, game, created_at) VALUES (?, ?, ?, ?)",
);
const stmtDel = db.prepare("DELETE FROM pending_bet WHERE user_id = ?");
const stmtPay = db.prepare(
  "UPDATE user SET money = money + ? WHERE user_id = ?",
);

const touchCache = (userId) => {
  cache.invalidateMoney(userId);
};

const hasPending = (userId) => Boolean(stmtHas.get(userId));

/** 베팅액을 차감해 보관한다. 잔액 부족이거나 이미 진행 중이면 false */
const startBet = db.transaction((userId, amount, game) => {
  if (stmtHas.get(userId)) return false;
  if (stmtTake.run(amount, userId, amount).changes !== 1) return false;
  stmtPut.run(userId, amount, game, Date.now());
  touchCache(userId);
  return true;
});

/** 정산: payout(원금 포함 지급액, 0이면 전액 손실)을 지급하고 보관 내역을 지운다 */
const settleBet = db.transaction((userId, payout) => {
  if (stmtDel.run(userId).changes !== 1) return false; // 이미 정산되었거나 돌려받음
  if (payout > 0) stmtPay.run(payout, userId);
  touchCache(userId);
  return true;
});

/** 시작 시 호출: 정산되지 않은 베팅을 모두 돌려준다 */
const refundPending = db.transaction(() => {
  const rows = db.prepare("SELECT user_id, amount FROM pending_bet").all();
  for (const r of rows) {
    stmtPay.run(r.amount, r.user_id);
    stmtDel.run(r.user_id);
    touchCache(r.user_id);
  }
  return rows.length;
});

module.exports = { hasPending, startBet, settleBet, refundPending };
