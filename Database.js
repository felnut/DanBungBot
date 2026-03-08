const Database = require("better-sqlite3");
const path = require("path");

// --test 옵션이 있으면 테스트 DB 사용, 아니면 실제 DB 사용
const isTest = process.argv.includes("--test");
const dbName = isTest ? "game-test.db" : "game.db";

// DB 연결
const db = new Database(path.join(__dirname, dbName));

// 유저 테이블 생성 (이미 있으면 스킵)
db.exec(`
    CREATE TABLE IF NOT EXISTS user (
        user_id TEXT PRIMARY KEY,             -- 유저 ID, 고유 키로 사용돼!
        money INTEGER DEFAULT 1000,           -- 보유 돈, 기본 1000원으로 시작
        daily_last_reset INTEGER DEFAULT 0,   -- 데일리 리셋 마지막 시간 (타임스탬프)
        streak INTEGER DEFAULT 0              -- 연속 출석 횟수, 데일리 보상용
    )
`);

// bank 테이블 생성 (이미 있으면 스킵)
db.exec(`
    CREATE TABLE IF NOT EXISTS bank (
        id INTEGER PRIMARY KEY AUTOINCREMENT,   -- 자동 증가 ID, 레코드 구분용
        amount INTEGER DEFAULT 0,               -- 은행 잔고 금액
        failed_attempts INTEGER DEFAULT 0       -- 실패 시도 횟수, 보안 관련
    )
`);

// bank 테이블에 데이터가 없으면 초기화 (amount와 failed_attempts를 0으로 삽입)
const bankRow = db.prepare("SELECT * FROM bank").get();
if (!bankRow) {
  db.prepare("INSERT INTO bank (amount, failed_attempts) VALUES (0, 0)").run();
}

// stocks 테이블 생성 (주식 정보 저장용, 여러 zkf럼 포함 - 이미 있으면 스킵)
db.exec(`
    CREATE TABLE IF NOT EXISTS stocks (
        symbol TEXT PRIMARY KEY,              -- 주식 심볼 (고유 키, ex: 'samsung')
        name TEXT,                            -- 주식 이름 (ex: '삼성전자')
        price REAL DEFAULT 10000.0,           -- 현재 가격
        base_t REAL,                          -- 기본 추세 (T) 값, 종목별 성장 곡선
        prev_return REAL DEFAULT 0.0,         -- 이전 수익률 (M 관성 계산용)
        cd REAL DEFAULT 0.0,                  -- ? (기획에 명시 안 됨, 기존 유지)
        last_crash TEXT,                      -- 마지막 폭락 날짜 (ISO 문자열)
        holding_ratio REAL DEFAULT 0.15,      -- 보유 비율 (기획에 명시 안 됨, 기존 유지)
        daily_bi REAL DEFAULT 0.0,            -- 일일 순매수 강도 (Bi)
        history TEXT DEFAULT '',              -- 주가 히스토리 (JSON 문자열로 저장)
        last_price REAL DEFAULT 0,            -- 이전 가격 (변동 계산용)
        last_change REAL DEFAULT 0,           -- 마지막 변동률 (%)
        cooldown_until INTEGER DEFAULT 0      -- 폭락 쿨타임 종료 시간 (타임스탬프)
    )
`);

// user_stocks 테이블 생성 (유저별 주식 보유 정보 저장용 - 이미 있으면 스킵)
db.exec(`
    CREATE TABLE IF NOT EXISTS user_stocks (
        user_id TEXT,                       -- 유저 ID (user 테이블 참조)
        symbol TEXT,                        -- 주식 심볼 (stocks 테이블 참조)
        shares INTEGER DEFAULT 0,           -- 보유 주식 수량
        avg_buy_price REAL DEFAULT 0,       -- 평균 매수 가격 (수익률 계산용)
        PRIMARY KEY (user_id, symbol)       -- 복합 키: 유저당 종목별 고유
    )
`);

// 마이그레이션 시작 로그
console.log("🔧 주식 시스템 마이그레이션 체크 중...");

// 개별 컬럼 추가 함수 (중복 에러 무시)
const addColumn = (tableName, columnDef) => {
  try {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDef};`);
    console.log(
      `✅ ${tableName} 에 컬럼 추가 성공: ${columnDef.split(" ")[0]}`,
    );
  } catch (e) {
    if (e.message.includes("duplicate column name")) {
      // 이미 있으면 무시
    } else {
      console.error(`❌ ${tableName} 마이그레이션 오류:`, e.message);
    }
  }
};

// stocks 테이블 컬럼들 개별 추가
addColumn("stocks", "name TEXT");
addColumn("stocks", "last_price REAL DEFAULT 0");
addColumn("stocks", "last_change REAL DEFAULT 0");
addColumn("stocks", "cooldown_until INTEGER DEFAULT 0");
addColumn("stocks", "last_news_title TEXT DEFAULT NULL");
addColumn("stocks", "last_news_time INTEGER DEFAULT 0");

// user_stocks 테이블 컬럼 추가
addColumn("user_stocks", "avg_buy_price REAL DEFAULT 0");

console.log("ℹ️ 마이그레이션 체크 완료");

// user_stocks 테이블에 avg_buy_price 컬럼 추가 시도 (이미 있으면 duplicate 오류 처리)
try {
  db.exec(`ALTER TABLE user_stocks ADD COLUMN avg_buy_price REAL DEFAULT 0;`); // 평균 매수 가격 칼럼 추가
  console.log("✅ avg_buy_price 컬럼 추가 완료");
} catch (e) {
  if (e.message.includes("duplicate column name")) {
    console.log("ℹ️ avg_buy_price 컬럼은 이미 있음");
  } else {
    console.error("❌ user_stocks 마이그레이션 오류:", e.message);
  }
}

// 종목 초기화
const initialStocks = [
  { symbol: "nct", name: "네오코어 테크", price: 145000, base_t: 0.0012 },
  { symbol: "hcp", name: "단소 캐피탈", price: 82000, base_t: 0.0008 },
  { symbol: "dac", name: "동아 건설", price: 39500, base_t: 0.0006 },
  { symbol: "gpf", name: "그린팜 푸드", price: 24800, base_t: 0.0009 },
  { symbol: "hlxm", name: "헬릭시온 메디컬", price: 168000, base_t: 0.0018 },
];

// 종목 삽입/업데이트 쿼리 준비 (INSERT OR REPLACE로 기존 데이터 덮어쓰기)
const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO stocks 
  (symbol, name, price, last_price, base_t, prev_return, cooldown_until)
  VALUES (@symbol, @name, @price, @price, @base_t, 0, 0)
`);

// 배열의 각 종목을 DB에 삽입/업데이트
const stockCount = db.prepare("SELECT COUNT(*) as cnt FROM stocks").get().cnt;

if (stockCount === 0) {
  console.log("stocks 테이블이 비어있음 → 초기 종목 데이터 삽입");

  const insertStmt = db.prepare(`
    INSERT INTO stocks 
    (symbol, name, price, last_price, base_t, prev_return, cooldown_until)
    VALUES (@symbol, @name, @price, @price, @base_t, 0, 0)
  `);

  initialStocks.forEach((stock) => insertStmt.run(stock));
  console.log("✅ 기획 종목 초기화 완료!");
} else {
  console.log("stocks 테이블에 이미 데이터 있음 → 초기화 스킵");
}

// --deploy 모드에서는 추가 로그만 찍고 넘어가도 됨
if (process.argv.includes("--deploy")) {
  console.log("ℹ️ --deploy 모드: stocks 초기화 스킵됨");
}

console.log(`✅ Connect Database Success! (${dbName})`);

module.exports = db;
