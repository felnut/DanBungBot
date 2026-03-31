const Database = require("better-sqlite3");
const path = require("path");

// ================== DB 연결 설정 ==================
// --test 옵션이 있으면 테스트 DB를 사용해 운영 데이터와 분리
const isTest = process.argv.includes("--test");
const dbName = isTest ? "game-test.db" : "game.db";
const db = new Database(path.join(__dirname, dbName));

// ================== 테이블 생성 로직 ==================
// IF NOT EXISTS를 사용해 최초 1회만 테이블이 생성

// 유저 정보 테이블
db.exec(`
    CREATE TABLE IF NOT EXISTS user (
        user_id TEXT PRIMARY KEY,             -- 유저 고유 ID
        money INTEGER DEFAULT 1000,           -- 보유 소지금
        daily_last_reset INTEGER DEFAULT 0,   -- 마지막 출석체크 시간
        streak INTEGER DEFAULT 0              -- 연속 출석 일수
    )
`);

// 은행 테이블 (서버 전역 공용 잔고 관리 등)
db.exec(`
    CREATE TABLE IF NOT EXISTS bank (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount INTEGER DEFAULT 0,
        failed_attempts INTEGER DEFAULT 0       -- 보안 실패 시도 횟수
    )
`);

// 은행 테이블이 비어있다면 초기 데이터(잔고 0원) 1줄 삽입
const bankRow = db.prepare("SELECT * FROM bank").get();
if (!bankRow) {
  db.prepare("INSERT INTO bank (amount, failed_attempts) VALUES (0, 0)").run();
}

// 주식 종목 정보 테이블
db.exec(`
    CREATE TABLE IF NOT EXISTS stocks (
        symbol TEXT PRIMARY KEY,              -- 종목 기호 (예: 'samsung')
        name TEXT,                            -- 종목명 (예: '삼성전자')
        price REAL DEFAULT 10000.0,           -- 현재 가격
        base_t REAL,                          -- 주가 성장(추세) 반영 값
        prev_return REAL DEFAULT 0.0,         -- 관성 계산용 이전 수익률
        cd REAL DEFAULT 0.0,                  -- 부가 변수
        last_crash TEXT,                      -- 마지막 폭락 시점
        holding_ratio REAL DEFAULT 0.15,      -- 유저 보유 비율 변수
        daily_bi REAL DEFAULT 0.0,            -- 일일 순매수 강도
        history TEXT DEFAULT '',              -- 주가 히스토리(그래프용 JSON)
        last_price REAL DEFAULT 0,            -- 직전 가격
        last_change REAL DEFAULT 0,           -- 마지막 변동률(%)
        cooldown_until INTEGER DEFAULT 0      -- 폭락 이후 쿨타임(타임스탬프)
    )
`);

// 4. 유저별 주식 보유량 정보 테이블 (다대다 관계 해소)
db.exec(`
    CREATE TABLE IF NOT EXISTS user_stocks (
        user_id TEXT,
        symbol TEXT,
        shares INTEGER DEFAULT 0,           -- 보유 주식 수량
        avg_buy_price REAL DEFAULT 0,       -- 평단가(수익률 계산용)
        PRIMARY KEY (user_id, symbol)       -- 복합키: 1유저는 1종목당 1개의 레코드만 가짐
    )
`);

// ================== 테이블 마이그레이션(업데이트) 로직 ==================
// 기존에 DB를 쓰던 유저라도 새로운 컬럼이 업데이트되었을 때 에러 없이 추가
console.log("🔧 주식 시스템 마이그레이션 체크 중...");

const addColumn = (tableName, columnDef) => {
  try {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDef};`);
    console.log(
      `✅ ${tableName} 에 컬럼 추가 성공: ${columnDef.split(" ")[0]}`,
    );
  } catch (e) {
    // "duplicate column name" 에러는 이미 컬럼이 존재하는 정상 상황 무시
    if (!e.message.includes("duplicate column name")) {
      console.error(`❌ ${tableName} 마이그레이션 오류:`, e.message);
    }
  }
};

// stocks 및 user_stocks 테이블에 새롭게 추가된 필수 컬럼들을 검사 및 반영
addColumn("stocks", "name TEXT");
addColumn("stocks", "last_price REAL DEFAULT 0");
addColumn("stocks", "last_change REAL DEFAULT 0");
addColumn("stocks", "cooldown_until INTEGER DEFAULT 0");
addColumn("stocks", "last_news_title TEXT DEFAULT NULL");
addColumn("stocks", "last_news_time INTEGER DEFAULT 0");
addColumn("user_stocks", "avg_buy_price REAL DEFAULT 0"); // 평단가 컬럼 등

console.log("ℹ️ 마이그레이션 체크 완료");

// (이전에 추가된 avg_buy_price 하드코딩 부분은 위의 addColumn으로 대체되었지만 호환성을 위해 유지됨)
try {
  db.exec(`ALTER TABLE user_stocks ADD COLUMN avg_buy_price REAL DEFAULT 0;`);
  console.log("✅ avg_buy_price 컬럼 추가 완료");
} catch (e) {
  if (e.message.includes("duplicate column name")) {
    console.log("ℹ️ avg_buy_price 컬럼은 이미 있음");
  } else {
    console.error("❌ user_stocks 마이그레이션 오류:", e.message);
  }
}

// ================== 최초 주식 종목 시드(Seed) 데이터 초기화 ==================
// 기획된 초기 종목 데이터 배열
const initialStocks = [
  { symbol: "nct", name: "네오코어 테크", price: 145000, base_t: 0.0012 },
  { symbol: "hcp", name: "단소 캐피탈", price: 82000, base_t: 0.0008 },
  { symbol: "dac", name: "동아 건설", price: 39500, base_t: 0.0006 },
  { symbol: "gpf", name: "그린팜 푸드", price: 24800, base_t: 0.0009 },
  { symbol: "hlxm", name: "헬릭시온 메디컬", price: 168000, base_t: 0.0018 },
];

const stockCount = db.prepare("SELECT COUNT(*) as cnt FROM stocks").get().cnt;

// stocks 테이블에 데이터가 단 하나도 없을 경우에만 초기 종목 세팅
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

if (process.argv.includes("--deploy")) {
  console.log("ℹ️ --deploy 모드: stocks 초기화 스킵됨");
}

console.log(`✅ Connect Database Success! (${dbName})`);

module.exports = db;
