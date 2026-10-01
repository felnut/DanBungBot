// 숫자야구 게임처럼 여러 번 상호작용하는 게임의 상태를 저장하는 파일
// (유저 ID → 게임 정보 Map). 재시작해도 이어서 할 수 있도록 SQLite에도 저장한다.
const db = require("../../../Database");

db.exec(`
  CREATE TABLE IF NOT EXISTS baseball_games (
    user_id TEXT PRIMARY KEY,
    state TEXT NOT NULL
  )
`);

const games = new Map();

// 시작 시 DB에 남아 있는 진행 중 게임 복구
for (const row of db.prepare("SELECT user_id, state FROM baseball_games").all()) {
  try {
    games.set(row.user_id, JSON.parse(row.state));
  } catch {
    db.prepare("DELETE FROM baseball_games WHERE user_id = ?").run(row.user_id);
  }
}

const stmtSave = db.prepare(
  "INSERT INTO baseball_games (user_id, state) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET state = excluded.state",
);
const stmtDelete = db.prepare("DELETE FROM baseball_games WHERE user_id = ?");

/** 현재 메모리의 게임 상태를 DB에 저장 */
function saveGame(userId) {
  const game = games.get(userId);
  if (game) stmtSave.run(userId, JSON.stringify(game));
}

/** 게임 종료: 메모리와 DB에서 모두 삭제 */
function deleteGame(userId) {
  games.delete(userId);
  stmtDelete.run(userId);
}

module.exports = { games, saveGame, deleteGame };
