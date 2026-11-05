const Database = require("better-sqlite3");
const path = require("path");

// ================== DB 연결 설정 ==================
const db = new Database(path.join(__dirname, "game.db"));

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
db.exec(
  `CREATE INDEX IF NOT EXISTS idx_stocks_last_news_time ON stocks(last_news_time);`,
);

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
ensureColumn("stocks", "latent_price REAL DEFAULT 0"); // 장 마감 중에도 계산되는 숨은 주가 (개장 시 갭으로 반영)
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
db.prepare(
  "INSERT OR IGNORE INTO market_state (id, vol_mult, last_day) VALUES (1, 1, NULL)",
).run();
// 주식 시장 1회성 초기화(개편) 완료 여부와, 아직 전송하지 못한 공지(JSON)
ensureColumn("market_state", "stock_reset_done INTEGER DEFAULT 0");
ensureColumn("market_state", "reset_notice TEXT DEFAULT NULL"); // 더 이상 사용하지 않음(자동 공지 제거)

// 서버 관리자 연락처 (운영 공지를 운영자가 수동으로 보낼 때만 사용) — 서버·사용자별 1건
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_contact (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    consented_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  )
`);

// 마지막 이용 시각(ms) — 12개월 미이용 계정 삭제 기준 (개인정보 처리방침 1항)
ensureColumn("user", "last_active INTEGER DEFAULT 0");
db.prepare("UPDATE user SET last_active = ? WHERE last_active = 0").run(
  Date.now(),
);

// 송금 기록 — 일일 송금 한도 계산용 (송금 후 7일이 지난 기록은 정리)
db.exec(`
  CREATE TABLE IF NOT EXISTS transfer_log (
    sender_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )
`);
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_transfer_sender ON transfer_log(sender_id, created_at);",
);

// 서버 D-day (/디데이) — 이름·날짜·만든 사람. 날짜가 30일 지나면 정기 정리에서 삭제
db.exec(`
  CREATE TABLE IF NOT EXISTS dday (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_dday_guild_date ON dday(guild_id, date);",
);

// DM 전용 명령어 — 알림(/알림): 시각이 되면 DM으로 보내고 바로 삭제 / 메모(/메모): 본인이 지울 때까지 보관
db.exec(`
  CREATE TABLE IF NOT EXISTS reminder (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    due_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_reminder_due ON reminder(due_at);");
db.exec(`
  CREATE TABLE IF NOT EXISTS memo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_memo_user ON memo(user_id);");

// 급식 알림 채널 설정 (/급식알림) — 서버당 1개, 채널 ID와 마지막 전송일만 저장
db.exec(`
  CREATE TABLE IF NOT EXISTS lunch_notice (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    last_sent TEXT
  )
`);

// 서버별 등록 학교 (/학교등록) — 시간표·학사일정·급식 조회에 사용. 서버마다 여러 학교를 등록할 수 있다
const tableExists = (name) =>
  Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name),
  );
const schoolsTableIsNew = !tableExists("guild_schools");
db.exec(`
  CREATE TABLE IF NOT EXISTS guild_schools (
    guild_id TEXT NOT NULL,
    school_code TEXT NOT NULL,
    atpt_code TEXT NOT NULL,
    school_name TEXT NOT NULL,
    school_kind TEXT NOT NULL,
    registered_by TEXT,
    registered_at INTEGER NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, school_code)
  )
`);
if (schoolsTableIsNew) {
  if (tableExists("guild_school")) {
    // 서버당 1개만 저장하던 이전 표의 내용을 옮기고 이전 표는 지운다 (한 번만 실행)
    db.exec(`
      INSERT OR IGNORE INTO guild_schools (guild_id, school_code, atpt_code, school_name, school_kind, registered_by, registered_at, is_default)
      SELECT guild_id, school_code, atpt_code, school_name, school_kind, registered_by, registered_at, 1 FROM guild_school;
      DROP TABLE guild_school;
    `);
  } else if (process.env.GUILD_ID) {
    // 처음 만든 DB라면, 운영 서버(GUILD_ID)에 기본 학교를 한 번 등록한다
    db.prepare(
      "INSERT OR IGNORE INTO guild_schools (guild_id, school_code, atpt_code, school_name, school_kind, registered_by, registered_at, is_default) VALUES (?, '7011489', 'B10', '단국대학교부속소프트웨어고등학교', '고등학교', NULL, ?, 1)",
    ).run(process.env.GUILD_ID, Date.now());
  }
}

// 서버별 이용 기록 — '현재 서버' 랭킹용 (서버 ID, 사용자 ID, 마지막 이용 시각). 사용자 삭제 시 함께 삭제
db.exec(`
  CREATE TABLE IF NOT EXISTS user_guild (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(user_id) ON DELETE CASCADE,
    last_seen INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  )
`);
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_user_guild_user ON user_guild(user_id);",
);
// 이전 버전에는 서버 구분이 없었으므로, 기존 이용자는 운영 서버(GUILD_ID)에서 이용한 것으로 한 번 등록한다
if (process.env.GUILD_ID && process.env.GUILD_RANK_ENABLED === "1") {
  db.prepare(
    "INSERT OR IGNORE INTO user_guild (guild_id, user_id, last_seen) SELECT ?, user_id, ? FROM user",
  ).run(process.env.GUILD_ID, Date.now());
}

// 음악 추천 설정 (/음악추천) — 서버 단위 설정만 저장하고 사용자 정보는 저장하지 않는다
// 자동 추천 켜짐 여부(기본 꺼짐)와, 서버 운영자가 추천 기준으로 등록한 사이트 주소
db.exec(`
  CREATE TABLE IF NOT EXISTS music_rec_config (
    guild_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS music_rec_source (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    url TEXT NOT NULL,
    label TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    UNIQUE (guild_id, url)
  )
`);

// 낚시 도감 (/낚시도감) — 잡은 물고기 종류별 횟수. 사용자 삭제 시 함께 삭제
db.exec(`
  CREATE TABLE IF NOT EXISTS fish_log (
    user_id TEXT NOT NULL REFERENCES user(user_id) ON DELETE CASCADE,
    fish TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, fish)
  )
`);

// 낚시 도구 (/낚시 미끼구매, /낚시 낚싯대구매) — 가진 낚싯대 단계와 미끼 개수. 사용자 삭제 시 함께 삭제
db.exec(`
  CREATE TABLE IF NOT EXISTS fishing_gear (
    user_id TEXT PRIMARY KEY REFERENCES user(user_id) ON DELETE CASCADE,
    rod INTEGER NOT NULL DEFAULT 0
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS fishing_bait (
    user_id TEXT NOT NULL REFERENCES user(user_id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    qty INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, kind)
  )
`);
// 낚시 도감은 어종 이름(이모지 포함) 대신 어종 키로 저장한다 — 기존 기록(이름)은 아래에서 한 번 옮긴다
const FISH_NAME_TO_KEY = {
  "👢 낡은 장화": "boot",
  "🐟 붕어": "crucian",
  "🐠 잉어": "carp",
  "🐡 농어": "bass",
  "🍣 연어": "salmon",
  "🦈 참치": "tuna",
  "👑 황금물고기": "gold",
};
for (const [name, key] of Object.entries(FISH_NAME_TO_KEY)) {
  db.prepare("UPDATE OR IGNORE fish_log SET fish = ? WHERE fish = ?").run(
    key,
    name,
  );
}

// 낚시 최고 기록 (/낚시 시작 결과 화면, /낚시 도감) — 어종별 내 가장 큰 크기. 사용자 삭제 시 함께 삭제
db.exec(`
  CREATE TABLE IF NOT EXISTS fish_best (
    user_id TEXT NOT NULL REFERENCES user(user_id) ON DELETE CASCADE,
    fish TEXT NOT NULL,
    cm REAL NOT NULL,
    PRIMARY KEY (user_id, fish)
  )
`);
// 서버 신기록 — 서버·어종별 가장 큰 크기와 잡은 사람. 서버별 이용 기록(GUILD_RANK_ENABLED)을 켠 뒤에만 저장한다
db.exec(`
  CREATE TABLE IF NOT EXISTS fish_record (
    guild_id TEXT NOT NULL,
    fish TEXT NOT NULL,
    cm REAL NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(user_id) ON DELETE CASCADE,
    PRIMARY KEY (guild_id, fish)
  )
`);

// 무기 강화 (/무기) — 한 사람이 최대 5개까지, 이름은 사람마다 겹치지 않게(대소문자 무시). 사용자 삭제 시 함께 삭제
db.exec(`
  CREATE TABLE IF NOT EXISTS weapons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES user(user_id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    level INTEGER NOT NULL DEFAULT 0,
    best_level INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    UNIQUE (user_id, name)
  )
`);
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_weapons_level ON weapons(level DESC, best_level DESC);",
);
ensureColumn("weapons", "exp INTEGER NOT NULL DEFAULT 0"); // 지금 단계에서 쌓은 경험치 (그 단계의 필요량을 넘으면 다음 단계)
// 이전 버전(사용자당 무기 1개, 이름이 없을 수 있음)의 weapon 테이블이 있으면 한 번 옮기고 지운다
if (tableExists("weapon")) {
  db.transaction(() => {
    db.exec(`INSERT OR IGNORE INTO weapons (user_id, name, level, best_level, updated_at)
             SELECT user_id, COALESCE(name, '무명 무기'), level, best_level, updated_at FROM weapon`);
    db.exec("DROP TABLE weapon");
  })();
  console.log("✅ 무기 테이블을 여러 개 보유 구조(weapons)로 옮겼어요");
}

// 주식 실현 수익 (/주식 수익) — 매도로 확정된 손익의 누적 합계
db.exec(`
  CREATE TABLE IF NOT EXISTS stock_realized (
    user_id TEXT PRIMARY KEY REFERENCES user(user_id) ON DELETE CASCADE,
    profit INTEGER NOT NULL DEFAULT 0
  )
`);

// 퀘스트·도전과제·뱃지 (/퀘스트, /도전과제, /뱃지, /프로필) — 모두 사용자 삭제 시 함께 삭제
// 누적 기록(출석·게임 횟수 등)
db.exec(`
  CREATE TABLE IF NOT EXISTS stat (
    user_id TEXT NOT NULL REFERENCES user(user_id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, key)
  )
`);
// 일일·주간·월간 퀘스트 진행도 (period_key: d:날짜 / w:그 주 월요일 날짜 / m:연-월)
db.exec(`
  CREATE TABLE IF NOT EXISTS quest_progress (
    user_id TEXT NOT NULL REFERENCES user(user_id) ON DELETE CASCADE,
    period_key TEXT NOT NULL,
    quest_id TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    claimed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, period_key, quest_id)
  )
`);
// 보상을 받은 도전과제 (받은 도전과제의 뱃지를 모을 수 있다)
db.exec(`
  CREATE TABLE IF NOT EXISTS achievement (
    user_id TEXT NOT NULL REFERENCES user(user_id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    claimed_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  )
`);
ensureColumn("user", "badge TEXT DEFAULT NULL"); // 프로필에 장착한 뱃지(도전과제 id)

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
    db.prepare("UPDATE user_stocks SET symbol = ? WHERE symbol = ?").run(
      to,
      from,
    );

    console.log(`✅ stocks/user_stocks 심볼 마이그레이션: ${from} → ${to}`);
  }
});
runSymbolMigrations();

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

console.log("✅ Connect Database Success! (game.db)");

module.exports = db;
