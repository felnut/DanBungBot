const Database = require("better-sqlite3");
const path = require("path");

// ================== DB 연결 설정 ==================
const isTest = process.argv.includes("--test");
const dbName = isTest ? "game-test.db" : "game.db";
const db = new Database(path.join(__dirname, dbName));

// ================== 파일 무결성 검사 ==================
console.log("🔍 DB 파일 무결성 검사 중...");
const integrityResult = db.prepare("PRAGMA integrity_check;").all();
if (
  integrityResult.length === 0 ||
  integrityResult[0].integrity_check !== "ok"
) {
  console.error(
    "❌ DB 파일이 손상되었습니다! 백업 파일을 확인하고 복구하세요.",
  );
} else {
  console.log("✅ DB 파일 무결성 정상");
}

// ================== 실행 환경 설정 (PRAGMA) ==================
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
console.log("✅ WAL 모드 & 외래키 활성화 완료");

// ================== 테이블 생성 ==================
db.exec(`
    CREATE TABLE IF NOT EXISTS user (
        user_id TEXT PRIMARY KEY,
        money INTEGER DEFAULT 1000,
        daily_last_reset INTEGER DEFAULT 0,
        streak INTEGER DEFAULT 0
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS bank (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount INTEGER DEFAULT 0,
        failed_attempts INTEGER DEFAULT 0
    )
`);

// stocks 테이블
db.exec(`
    CREATE TABLE IF NOT EXISTS stocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT UNIQUE NOT NULL,
        name TEXT,
        price REAL DEFAULT 10000.0,
        base_t REAL,
        prev_return REAL DEFAULT 0.0,
        cd REAL DEFAULT 0.0,
        last_crash TEXT,
        holding_ratio REAL DEFAULT 0.15,
        daily_bi REAL DEFAULT 0.0,
        history TEXT DEFAULT '',
        last_price REAL DEFAULT 0,
        last_change REAL DEFAULT 0,
        cooldown_until INTEGER DEFAULT 0,
        last_news_title TEXT DEFAULT NULL,
        last_news_time INTEGER DEFAULT 0
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS user_stocks (
        user_id TEXT,
        symbol TEXT,
        shares INTEGER DEFAULT 0,
        avg_buy_price REAL DEFAULT 0,
        PRIMARY KEY (user_id, symbol),
        FOREIGN KEY (user_id) REFERENCES user(user_id) ON DELETE CASCADE,
        FOREIGN KEY (symbol) REFERENCES stocks(symbol) ON DELETE RESTRICT
    )
`);

// ================== 인덱스 생성(멱등) ==================
// 랭킹/순위 계산: ORDER BY / WHERE money > ? 최적화
db.exec(`CREATE INDEX IF NOT EXISTS idx_user_money ON user(money);`);
// 최근 뉴스 1건 조회 최적화
db.exec(`CREATE INDEX IF NOT EXISTS idx_stocks_last_news_time ON stocks(last_news_time);`);

// ================== 스키마 자동 마이그레이션 ==================
console.log("🔧 스키마 자동 마이그레이션 체크 중...");

// ensureColumn 함수 정의 (기존 거 그대로 유지)
const ensureColumn = (tableName, columnDef) => {
  try {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDef};`);
    console.log(`✅ ${tableName} 에 새 컬럼 추가: ${columnDef.split(" ")[0]}`);
  } catch (e) {
    if (!e.message.includes("duplicate column name")) {
      console.error(`❌ ${tableName} 마이그레이션 오류:`, e.message);
    }
  }
};

// stocks 테이블에 id 컬럼이 있는지 확인
const stocksColumns = db.prepare("PRAGMA table_info(stocks)").all();
const hasIdColumn = stocksColumns.some((col) => col.name === "id");

if (!hasIdColumn) {
  console.log(
    "🛠️ stocks 테이블에 id PRIMARY KEY가 없어서 재생성합니다... (데이터 보존)",
  );

  try {
    db.exec(`
      -- 1. 기존 테이블 백업
      CREATE TABLE IF NOT EXISTS stocks_backup AS SELECT * FROM stocks;

      -- 2. id 컬럼 포함한 새 테이블 생성
      CREATE TABLE stocks_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT UNIQUE NOT NULL,
          name TEXT,
          price REAL DEFAULT 10000.0,
          base_t REAL,
          prev_return REAL DEFAULT 0.0,
          cd REAL DEFAULT 0.0,
          last_crash TEXT,
          holding_ratio REAL DEFAULT 0.15,
          daily_bi REAL DEFAULT 0.0,
          history TEXT DEFAULT '',
          last_price REAL DEFAULT 0,
          last_change REAL DEFAULT 0,
          cooldown_until INTEGER DEFAULT 0,
          last_news_title TEXT DEFAULT NULL,
          last_news_time INTEGER DEFAULT 0
      );

      -- 3. 데이터 옮기기 (id는 자동 생성)
      INSERT INTO stocks_new (symbol, name, price, base_t, prev_return, cd, last_crash, 
                              holding_ratio, daily_bi, history, last_price, last_change, 
                              cooldown_until, last_news_title, last_news_time)
      SELECT symbol, name, price, base_t, prev_return, cd, last_crash, 
             holding_ratio, daily_bi, history, 
             price AS last_price, 
             0 AS last_change, 
             0 AS cooldown_until, 
             NULL AS last_news_title, 
             0 AS last_news_time
      FROM stocks_backup;

      -- 4. 테이블 교체
      DROP TABLE stocks;
      ALTER TABLE stocks_new RENAME TO stocks;

      -- 백업 정리
      DROP TABLE stocks_backup;
    `);

    console.log("✅ stocks 테이블에 id PRIMARY KEY 추가 완료! (데이터 유지됨)");
  } catch (e) {
    console.error("❌ stocks 재생성 중 오류 발생:", e.message);
    throw e; // 심각한 오류면 여기서 멈추게
  }
} else {
  console.log("✅ stocks 테이블에 이미 id 컬럼이 있습니다.");
}

// 나머지 컬럼들 안전하게 추가
ensureColumn("stocks", "last_price REAL DEFAULT 0");
ensureColumn("stocks", "last_change REAL DEFAULT 0");
ensureColumn("stocks", "cooldown_until INTEGER DEFAULT 0");
ensureColumn("stocks", "last_news_title TEXT DEFAULT NULL");
ensureColumn("stocks", "last_news_time INTEGER DEFAULT 0");
ensureColumn("user_stocks", "avg_buy_price REAL DEFAULT 0");
// 일봉(시가/고가/저가) 컬럼 — 전일 종가는 last_price를 사용
ensureColumn("stocks", "day_open REAL DEFAULT 0");
ensureColumn("stocks", "day_high REAL DEFAULT 0");
ensureColumn("stocks", "day_low REAL DEFAULT 0");

// 시장 상태(변동성 국면, 마지막 거래일) — 단일 행(id=1)
db.exec(`
  CREATE TABLE IF NOT EXISTS market_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    vol_mult REAL DEFAULT 1,
    last_day TEXT
  )
`);
db.prepare("INSERT OR IGNORE INTO market_state (id, vol_mult, last_day) VALUES (1, 1, NULL)").run();

console.log("ℹ️ 마이그레이션 완료");

// ================== 초기 종목 데이터 ==================
const initialStocks = [
  { symbol: "hys", name: "한양반도체", price: 145000, base_t: 0.0012 },
  { symbol: "ftc", name: "퓨처캐피탈", price: 82000, base_t: 0.0008 },
  { symbol: "djc", name: "대진건설", price: 39500, base_t: 0.0006 },
  { symbol: "hgf", name: "한그린푸드", price: 24800, base_t: 0.0009 },
  { symbol: "bhx", name: "바이오헬릭스", price: 168000, base_t: 0.0018 },
  // sugget.md 추가 종목
  { symbol: "msd", name: "마이크로스터디", price: 91000, base_t: 0.001 },
  { symbol: "sgmn", name: "서재미나이", price: 132000, base_t: 0.0015 },
];

// ================== 심볼 마이그레이션 (데이터 보존) ==================
// 기존 심볼을 새 심볼로 rename하되, 가격/히스토리/보유주식 등 나머지 컬럼은 그대로 유지합니다.
// (새 심볼이 이미 존재하면 충돌 방지를 위해 스킵)
const symbolMigrations = [
  { from: "sam", to: "hys" },
  { from: "dsc", to: "ftc" },
  { from: "dab", to: "djc" },
  { from: "gpf", to: "hgf" },
  { from: "hlxm", to: "bhx" },
];

const runSymbolMigrations = db.transaction(() => {
  for (const { from, to } of symbolMigrations) {
    const fromRow = db
      .prepare("SELECT 1 FROM stocks WHERE symbol = ?")
      .get(from);
    if (!fromRow) continue;

    const toRow = db.prepare("SELECT 1 FROM stocks WHERE symbol = ?").get(to);
    if (toRow) continue;

    db.prepare("UPDATE stocks SET symbol = ? WHERE symbol = ?").run(to, from);
    db.prepare("UPDATE user_stocks SET symbol = ? WHERE symbol = ?").run(to, from);

    console.log(`✅ stocks/user_stocks 심볼 마이그레이션: ${from} → ${to}`);
  }
});
runSymbolMigrations();

// 은행 Seed
// bank는 단일 row(id=1)만 사용하도록 고정합니다.
if (!db.prepare("SELECT 1 FROM bank WHERE id = 1").get()) {
  db.prepare("INSERT INTO bank (id, amount, failed_attempts) VALUES (1, 0, 0)").run();
  console.log("✅ bank 초기 데이터 삽입 (id=1)");
}

// stocks Seed (완전히 비어있을 때만)
const stockCount = db.prepare("SELECT COUNT(*) as cnt FROM stocks").get().cnt;
if (stockCount === 0) {
  console.log("stocks 테이블 비어있음 → 초기 종목 삽입");
  const insertStmt = db.prepare(`
    INSERT INTO stocks (symbol, name, price, last_price, base_t, prev_return, cooldown_until)
    VALUES (@symbol, @name, @price, @price, @base_t, 0, 0)
  `);
  initialStocks.forEach((stock) => insertStmt.run(stock));
  console.log("✅ stocks 초기 종목 삽입 완료!");
} else {
  console.log(`ℹ️ stocks에 이미 ${stockCount}개 데이터 있음`);
}

// ================== 이름·심볼 동기화 (id는 자동 생성) ==================
console.log("🔄 이름·심볼 동기화 시작...");

const updateNameStmt = db.prepare(
  "UPDATE stocks SET name = ? WHERE symbol = ?",
);
const updateBaseTStmt = db.prepare(
  "UPDATE stocks SET base_t = ? WHERE symbol = ?",
);
const insertStmt = db.prepare(`
  INSERT INTO stocks (symbol, name, price, last_price, base_t, prev_return, cooldown_until)
  VALUES (@symbol, @name, @price, @price, @base_t, 0, 0)
`);

initialStocks.forEach((stock) => {
  const existing = db
    .prepare("SELECT id, name, base_t FROM stocks WHERE symbol = ?")
    .get(stock.symbol);

  if (existing) {
    if (existing.name !== stock.name) {
      updateNameStmt.run(stock.name, stock.symbol);
      console.log(`✅ ${stock.symbol} 이름 업데이트 → ${stock.name}`);
    }
    if (existing.base_t !== stock.base_t) {
      updateBaseTStmt.run(stock.base_t, stock.symbol);
      console.log(`✅ ${stock.symbol} base_t 업데이트`);
    }
  } else {
    insertStmt.run(stock);
    console.log(`✅ 새 종목 추가 → ${stock.symbol} (${stock.name})`);
  }
});

console.log("✅ 이름·심볼 동기화 완료!");

console.log(`✅ Connect Database Success! (${dbName})`);

module.exports = db;
