const db = require("../../Database");
const { EmbedBuilder } = require("discord.js");
const cache = require("../commands/utils/cache");

// 프리페어드 스테이트먼트 사용 (자주 실행되는 구간에서 쿼리 재준비 비용 제거)
const stmtSelectAllStocks = db.prepare("SELECT symbol, price FROM stocks");
const stmtUpdateStockNoNews = db.prepare(
  "UPDATE stocks SET price = ?, last_change = ? WHERE symbol = ?",
);
const stmtUpdateStockWithNews = db.prepare(
  "UPDATE stocks SET price = ?, last_change = ?, last_news_title = ?, last_news_time = ? WHERE symbol = ?",
);

const stmtSelectStockPrice = db.prepare(
  "SELECT price FROM stocks WHERE symbol = ?",
);
const stmtSelectUserMoney = db.prepare(
  "SELECT money FROM user WHERE user_id = ?",
);
const stmtUpdateUserMoneyDelta = db.prepare(
  "UPDATE user SET money = money + ? WHERE user_id = ?",
);
const stmtSelectUserStock = db.prepare(
  "SELECT shares, avg_buy_price FROM user_stocks WHERE user_id = ? AND symbol = ?",
);
const stmtUpdateUserStock = db.prepare(
  "UPDATE user_stocks SET shares = ?, avg_buy_price = ? WHERE user_id = ? AND symbol = ?",
);
const stmtInsertUserStock = db.prepare(
  "INSERT INTO user_stocks (user_id, symbol, shares, avg_buy_price) VALUES (?, ?, ?, ?)",
);
const stmtSelectHoldingShares = db.prepare(
  "SELECT shares FROM user_stocks WHERE user_id = ? AND symbol = ?",
);
const stmtUpdateHoldingSharesDelta = db.prepare(
  "UPDATE user_stocks SET shares = shares - ? WHERE user_id = ? AND symbol = ?",
);
const stmtDeleteHolding = db.prepare(
  "DELETE FROM user_stocks WHERE user_id = ? AND symbol = ?",
);

const stmtSelectStocksForEmbed = db.prepare(
  "SELECT id, symbol, name, price, last_price, day_open, day_high, day_low, history, last_change, last_news_title, last_news_time FROM stocks ORDER BY id ASC",
);
const stmtSelectRecentNews = db.prepare(`
      SELECT name, last_news_title, last_news_time 
      FROM stocks 
      WHERE last_news_title IS NOT NULL 
      ORDER BY last_news_time DESC 
      LIMIT 1
    `);
const stmtSelectHoldingsForUser = db.prepare(`
      SELECT us.*, s.name, s.price, s.last_change
      FROM user_stocks us 
      JOIN stocks s ON us.symbol = s.symbol 
      WHERE us.user_id = ?
    `);

// 기본 정보 (고정값)
// 뉴스 시작
const NEWS_POOL = {
  hys: [
    {
      title:
        "[단독] 세계 최초 '1.4nm 파운드리' 수율 70% 돌파… 차세대 양자 칩 양산 개시.",
      impactMin: 0.18,
      impactMax: 0.32,
    },
    {
      title:
        "엔비디아 차세대 AI 가속기용 'HBM4' 독점 공급 계약… 7년간 수십조 원 규모.",
      impactMin: 0.08,
      impactMax: 0.18,
    },
    {
      title:
        '"AI 반도체 초격차 확보"… 용인 클러스터에 110조 원 규모 R&D 센터 착공.',
      impactMin: 0.07,
      impactMax: 0.16,
    },
    {
      title:
        "차세대 공정 노광 장비(EUV) 도입 지연… 하반기 신제품 라인업 출시 연기 우려.",
      impactMin: -0.06,
      impactMax: -0.14,
    },
    {
      title:
        "美 상무부, 대중국 반도체 장비 수출 통제 리스트 추가… 일부 구형 공정 타격.",
      impactMin: -0.05,
      impactMax: -0.12,
    },
    {
      title:
        "기술 유출 및 핵심 설계 인력 집단 이직… '미래 전략 프로젝트' 사실상 전면 중단.",
      impactMin: -0.12,
      impactMax: -0.25,
    },
  ],
  ftc: [
    {
      title:
        "금융당국 'STO(토큰증권) 법제화' 확정… dsc 디지털 자산 플랫폼 거래액 10조 원 돌파.",
      impactMin: 0.18,
      impactMax: 0.32,
    },
    {
      title:
        "정부 주도 'K-소상공인 상생 금융' 전담 운용사 선정… 대출 잔액 및 수수료 수익 급증.",
      impactMin: 0.07,
      impactMax: 0.16,
    },
    {
      title:
        "동남아 5개국 '디지털 뱅킹' 라이선스 취득 완료… 글로벌 송금 시장 점유율 1위 목표.",
      impactMin: 0.08,
      impactMax: 0.17,
    },
    {
      title:
        "고금리 장기화에 따른 연체율 경고등… 금감원, 부실채권(NPL) 상각 및 대손충당금 증액 권고.",
      impactMin: -0.07,
      impactMax: -0.15,
    },
    {
      title:
        "망 분리 규정 위반 및 개인정보 관리 소홀로 금융위로부터 고액 과징금 부과.",
      impactMin: -0.05,
      impactMax: -0.11,
    },
    {
      title:
        "[특보] 전산망 마비 및 사상 최대 규모 뱅킹 해킹 사고 발생… 영업정지 및 고객 이탈 가속화.",
      impactMin: -0.15,
      impactMax: -0.28,
    },
  ],
  djc: [
    {
      title:
        "국토부, 'GTX-C 노선 연장' 우선협상대상자로 대진건설 컨소시엄 선정… 역세권 개발권 확보.",
      impactMin: 0.17,
      impactMax: 0.3,
    },
    {
      title:
        "사우디 네옴시티 2단계 '옥사곤' 해상 플랜트 건설 수주… 12억 달러 규모 잭팟.",
      impactMin: 0.07,
      impactMax: 0.15,
    },
    {
      title:
        "AI 기반 'BIM(빌딩 정보 모델링)' 기술 전 현장 도입… 공기 단축 및 원가율 15% 개선.",
      impactMin: 0.06,
      impactMax: 0.14,
    },
    {
      title:
        "국제 원자재가 상승 및 시멘트 공급 차질… 주요 수도권 현장 공사 일시 중단 및 공기 지연.",
      impactMin: -0.06,
      impactMax: -0.13,
    },
    {
      title:
        "고용노동부 특별 감독 결과 안전 관리 소홀 적발… 전국 현장 일제 정밀 점검 실시.",
      impactMin: -0.05,
      impactMax: -0.12,
    },
    {
      title:
        "신축 아파트 단지 지하 주차장 '붕괴 사고' 발생… 부실시공 논란에 따른 전면 재시공 및 천문학적 배상.",
      impactMin: -0.14,
      impactMax: -0.27,
    },
  ],
  hgf: [
    {
      title:
        '"냉동 김밥·라면 없어서 못 판다"… 북미 월마트 입점 성공에 수출액 3배 급증.',
      impactMin: 0.17,
      impactMax: 0.31,
    },
    {
      title:
        "독자 개발 '식물성 배양육' 식약처 승인 완료… 국내 주요 편의점 및 프랜차이즈 납품 시작.",
      impactMin: 0.06,
      impactMax: 0.14,
    },
    {
      title:
        "유럽 프리미엄 가공식품 시장 진출… 현지 대형 유통 체인과 전략적 파트너십 체결.",
      impactMin: 0.08,
      impactMax: 0.16,
    },
    {
      title:
        "국제 곡물가 및 유가 동반 상승… 물류비 부담 증가로 영업이익률 하락 불가피.",
      impactMin: -0.06,
      impactMax: -0.13,
    },
    {
      title: "해외 수출용 제품 일부에서 성분 표시 미비로 인한 자발적 리콜 실시.",
      impactMin: -0.05,
      impactMax: -0.11,
    },
    {
      title:
        "[속보] 주력 가공육 제품, 유해 물질 다량 검출 발생… 전 유통 채널 긴급 판매 중단.",
      impactMin: -0.13,
      impactMax: -0.26,
    },
  ],
  bhx: [
    {
      title:
        "'기적의 항암제' 탄생하나? mRNA 범암 치료제 글로벌 임상 3상 데이터 평가지표 충족.",
      impactMin: 0.22,
      impactMax: 0.35,
    },
    {
      title:
        "희귀질환 치료제 후보물질 'HLX-101', FDA 패스트트랙 지정… 하반기 신약 허가 기대.",
      impactMin: 0.07,
      impactMax: 0.16,
    },
    {
      title:
        "국내 제약사 최초 알츠하이머 치료제 2상서 '인지 저하 유의미한 지연' 확인.",
      impactMin: 0.09,
      impactMax: 0.18,
    },
    {
      title:
        "국내외 임상 사이트 환자 모집 지연… 신약 상용화 로드맵 상반기에서 내년으로 연기.",
      impactMin: -0.07,
      impactMax: -0.15,
    },
    {
      title:
        "특허청, 주력 바이오시밀러 제형 특허 무효 결정… 경쟁사 시장 진입 가시화.",
      impactMin: -0.06,
      impactMax: -0.13,
    },
    {
      title:
        "[단독] 메가 블록버스터 기대주 임상 3상 '유효성 입증 실패'… 개발 프로젝트 전면 폐기.",
      impactMin: -0.18,
      impactMax: -0.32,
    },
  ],
  msd: [
    {
      title:
        '"학습지 대신 AI 구독" 스마트올 500만 돌파… 구독 매출 3배 폭증',
      impactMin: 0.18,
      impactMax: 0.33,
    },
    {
      title:
        "디지털 교과서 전국 도입 확대… 온라인 교육 콘텐츠 공급 계약 체결",
      impactMin: 0.09,
      impactMax: 0.2,
    },
    {
      title:
        "K-에듀 해외 습격… 코딩·로봇 교육 솔루션 북미·동남아 점유율 1위",
      impactMin: 0.07,
      impactMax: 0.16,
    },
    {
      title:
        '"텅 빈 학원가" 오프라인 수강생 감소 및 경쟁 심화… 영업이익률 하락 우려',
      impactMin: -0.06,
      impactMax: -0.14,
    },
    {
      title:
        "문제 유출 의심으로 저작권 침해 소송 및 일부 서비스 중단 리스크",
      impactMin: -0.05,
      impactMax: -0.12,
    },
    {
      title:
        "[속보] 前 수능 출제위원과 사설 강사 결탁... 문제 유출 의심으로 모 강사 불구속입건",
      impactMin: -0.21,
      impactMax: -0.43,
    },
  ],
  sgmn: [
    {
      title:
        "'SeoGemini 4.0' 대규모 업데이트 적중… 기업용 B2B 계약 10배 폭증",
      impactMin: 0.2,
      impactMax: 0.35,
    },
    {
      title:
        '"인터넷 없어도 인공지능 구동" 온디바이스 칩 개발 성공… 로봇·모바일 시장 진격',
      impactMin: 0.12,
      impactMax: 0.25,
    },
    {
      title:
        '글로벌 빅테크에 인공지능 학습 데이터 독점 공급… "데이터가 돈" 연 매출 5조 전망',
      impactMin: 0.1,
      impactMax: 0.22,
    },
    {
      title:
        '"전력 수급난에 학습 중단" 인공지능 모델 개발 비용 급증 및 출시 일정 지연',
      impactMin: -0.08,
      impactMax: -0.17,
    },
    {
      title:
        "미·중 인공지능 패권 전쟁 직격탄… 수출 통제 및 기술 이전 제한에 해외 매출 타격",
      impactMin: -0.07,
      impactMax: -0.15,
    },
    {
      title:
        "차세대 인공지능 모델 '환각 현상' 통제 실패… 수조 원대 프로젝트 전면 개편으로 사상 최대 손실",
      impactMin: -0.16,
      impactMax: -0.3,
    },
  ],
};
// 뉴스 끝

// 종목 시작
const STOCKS = {
  // vol: 종목 고유 변동성, beta: 시장 전체 움직임에 대한 민감도, base: 지수 기준가
  hys: { name: "한양반도체", base_t: 0.0012, news: 1.4, vol: 1.0, beta: 1.3, base: 145000 },
  ftc: { name: "퓨처캐피탈", base_t: 0.0008, news: 1.2, vol: 0.8, beta: 1.1, base: 82000 },
  djc: { name: "대진건설", base_t: 0.0006, news: 1.1, vol: 0.6, beta: 0.9, base: 39500 },
  hgf: { name: "한그린푸드", base_t: 0.0009, news: 1.3, vol: 0.7, beta: 0.5, base: 24800 },
  bhx: { name: "바이오헬릭스", base_t: 0.0018, news: 1.6, vol: 1.6, beta: 1.0, base: 168000 },
  msd: { name: "마이크로스터디", base_t: 0.001, news: 1.25, vol: 1.1, beta: 0.8, base: 91000 },
  sgmn: { name: "서재미나이", base_t: 0.0015, news: 1.45, vol: 1.4, beta: 1.4, base: 132000 },
};
//종목 끝

/**
 * 주가 랜덤 변동 + 뉴스 이벤트 적용
 * (주기적으로 호출됨 - 보통 setInterval로)
 */
// ── 주가 모델: 실제 증시처럼 동작 ──
// • 정규장: 평일 09:00~15:30(KST)에만 시세가 움직인다. 그 외(장 마감·주말)에는 마지막 종가가 유지되고,
//   거래는 항상 가능(시간외 종가 거래).
// • 시장 공통 요인(시장 전체의 움직임)에 종목별 베타를 곱한 값 + 종목 고유 움직임(+뉴스)으로 구성된다.
// • 변동성 국면(평온/보통/불안)이 가끔 바뀌어 변동성이 한동안 지속된다(변동성 군집).
// • 전일 종가 대비 ±30% 가격 제한폭(상한가/하한가), 매 거래일 시가·고가·저가·종가 기록.
// • 모든 움직임의 상승 확률은 49.5% : 하락 50.5% → 큰 수의 법칙으로 장기 보유할수록 소폭 손해(하우스 엣지 1%).
const TICK_MINUTES = 10;
const UP_PROB = 0.495;
const BASE_STEP = 0.0028; // 종목 고유 틱 변동폭 (vol 곱함)
const MARKET_STEP = 0.002; // 시장 공통 틱 변동폭 (beta 곱함)
const NEWS_PROB = 0.02; // 틱당 뉴스 발생 확률
const NEWS_STEP = 0.02; // 뉴스 틱 고유 변동폭
const DAILY_LIMIT = 0.3; // 가격 제한폭 (전일 종가 대비)
const MARKET_OPEN_MIN = 9 * 60; // 09:00
const MARKET_CLOSE_MIN = 15 * 60 + 30; // 15:30
const REGIMES = [
  { mult: 0.7, label: "😌 평온" },
  { mult: 1.0, label: "🙂 보통" },
  { mult: 1.0, label: "🙂 보통" },
  { mult: 1.6, label: "😰 불안" },
];
const REGIME_SWITCH_PROB = 0.02; // 틱당 국면 전환 확률

// market_state 테이블과 stocks.day_open/day_high/day_low 컬럼은 Database.js 마이그레이션에서 생성된다.
const stmtMarketState = db.prepare("SELECT vol_mult, last_day FROM market_state WHERE id = 1");
const stmtSetVol = db.prepare("UPDATE market_state SET vol_mult = ? WHERE id = 1");
const stmtSetDay = db.prepare("UPDATE market_state SET last_day = ? WHERE id = 1");
const stmtAllForTick = db.prepare(
  "SELECT symbol, price, last_price, day_open, day_high, day_low, history FROM stocks",
);
const stmtRollover = db.prepare(
  "UPDATE stocks SET last_price = price, day_open = price, day_high = price, day_low = price, history = ? WHERE symbol = ?",
);
const stmtTickNoNews = db.prepare(
  "UPDATE stocks SET price = ?, last_change = ?, day_high = ?, day_low = ? WHERE symbol = ?",
);
const stmtTickWithNews = db.prepare(
  "UPDATE stocks SET price = ?, last_change = ?, day_high = ?, day_low = ?, last_news_title = ?, last_news_time = ? WHERE symbol = ?",
);

/** 한국 표준시(KST) 시각 정보 (UTC getter로 읽는다) */
function getKST(date = new Date()) {
  const k = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    dayStr: k.toISOString().slice(0, 10),
    weekday: k.getUTCDay(), // 0=일 ... 6=토
    minutes: k.getUTCHours() * 60 + k.getUTCMinutes(),
  };
}

/** 정규장 여부 */
function isMarketOpen(date = new Date()) {
  const { weekday, minutes } = getKST(date);
  return (
    weekday >= 1 &&
    weekday <= 5 &&
    minutes >= MARKET_OPEN_MIN &&
    minutes < MARKET_CLOSE_MIN
  );
}

function currentRegime() {
  const { vol_mult } = stmtMarketState.get();
  return REGIMES.find((r) => r.mult === vol_mult) || REGIMES[1];
}

/** 시장 상태 문구 */
function getMarketStatus() {
  const open = isMarketOpen();
  return { open, label: open ? "🟢 장중 (09:00~15:30)" : "🔴 장 마감 (시간외 종가 거래)" };
}

/** 새 거래일 시작: 어제 종가를 기록하고 전일 종가/시가/고가/저가를 초기화 */
function rolloverDay(dayStr) {
  const rows = stmtAllForTick.all();
  for (const r of rows) {
    const hist = (r.history ? r.history.split(",").filter(Boolean) : []).concat(String(r.price));
    stmtRollover.run(hist.slice(-20).join(","), r.symbol);
  }
  stmtSetDay.run(dayStr);
}

/**
 * 주가 한 틱 갱신 (TICK_MINUTES분마다 호출). 장이 닫혀 있으면 아무것도 하지 않는다.
 * @param {{force?: boolean}} [opts] force=true면 장 시간과 무관하게 한 틱 진행(관리자 테스트용)
 * @returns {boolean} 갱신 여부
 */
async function updateStockPrices({ force = false } = {}) {
  if (!force && !isMarketOpen()) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  const { dayStr } = getKST();

  const tx = db.transaction(() => {
    // 새 거래일이면 일봉 롤오버
    if (stmtMarketState.get().last_day !== dayStr) rolloverDay(dayStr);

    // 변동성 국면 전환
    if (Math.random() < REGIME_SWITCH_PROB) {
      stmtSetVol.run(REGIMES[Math.floor(Math.random() * REGIMES.length)].mult);
    }
    const regime = stmtMarketState.get().vol_mult;

    // 시장 공통 요인 (모든 종목에 beta를 곱해 반영)
    const marketUp = Math.random() < UP_PROB;
    const marketRet =
      (marketUp ? 1 : -1) * MARKET_STEP * regime * (0.5 + Math.random());

    for (const stock of stmtAllForTick.all()) {
      const info = STOCKS[stock.symbol];
      if (!info) continue;

      // 종목 고유 요인 (+ 방향에 맞는 뉴스)
      const up = Math.random() < UP_PROB;
      let news = null;
      if (Math.random() < NEWS_PROB) news = getRandomNews(stock.symbol, up);
      const idioStep = news
        ? NEWS_STEP * info.vol * (0.7 + 0.6 * Math.random())
        : BASE_STEP * info.vol * regime * (0.5 + Math.random());
      const change = (info.beta ?? 1) * marketRet + (up ? idioStep : -idioStep);

      // 전일 종가 대비 가격 제한폭 적용
      const prevClose = stock.last_price || stock.price;
      const lower = Math.max(Math.round(prevClose * (1 - DAILY_LIMIT)), 1);
      const upper = Math.round(prevClose * (1 + DAILY_LIMIT));
      const newPrice = Math.min(
        Math.max(Math.round(stock.price * (1 + change)), lower),
        upper,
      );

      const high = Math.max(stock.day_high || stock.price, newPrice);
      const low = Math.min(stock.day_low || stock.price, newPrice);
      const realized = stock.price > 0 ? newPrice / stock.price - 1 : 0;

      if (news) {
        stmtTickWithNews.run(newPrice, realized, high, low, news.title, nowSec, stock.symbol);
      } else {
        stmtTickNoNews.run(newPrice, realized, high, low, stock.symbol);
      }
    }
  });

  tx();

  // prices/news changed -> bust relevant caches
  cache.del("stocks:snapshotRows");
  cache.del("stocks:recentNews");
  cache.del("leaderboard:stock_value:top10");
  return true;
}

/**
 * 종목별 랜덤 뉴스 가져오기 (up=true: 호재, false: 악재)
 */
function getRandomNews(symbol, up) {
  const pool = (NEWS_POOL[symbol] || []).filter((n) =>
    up ? n.impactMin + n.impactMax > 0 : n.impactMin + n.impactMax < 0,
  );
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ────────────────────────────────────────────────
// 매수 / 매도 함수들 (buyStock, sellStock)
// ────────────────────────────────────────────────

function buyStock(userId, symbol, quantity) {
  const tx = db.transaction(() => {
    const stock = stmtSelectStockPrice.get(symbol);
    if (!stock) throw new Error("존재하지 않는 종목입니다.");

    const totalCost = Math.round(stock.price * quantity);

    const user = stmtSelectUserMoney.get(userId);
    if (!user) throw new Error("가입되지 않은 사용자입니다.");
    if (user.money < 0)
      throw new Error("통장 잔고가 음수여서 매수할 수 없습니다.");

    const newMoney = user.money - totalCost;
    if (newMoney < 0) throw new Error("잔액 부족으로 매수할 수 없습니다.");

    stmtUpdateUserMoneyDelta.run(-totalCost, userId);

    const existing = stmtSelectUserStock.get(userId, symbol);
    if (existing) {
      const newShares = existing.shares + quantity;
      const newAvg =
        (existing.avg_buy_price * existing.shares + totalCost) / newShares;
      stmtUpdateUserStock.run(newShares, newAvg, userId, symbol);
    } else {
      stmtInsertUserStock.run(userId, symbol, quantity, stock.price);
    }
  });

  tx();

  // holdings & derived leaderboards changed
  cache.del(`portfolio:${userId}`);
  cache.del("leaderboard:stock_value:top10");
}

function sellStock(userId, symbol, quantity) {
  const tx = db.transaction(() => {
    const holding = stmtSelectHoldingShares.get(userId, symbol);
    if (!holding || holding.shares < quantity)
      throw new Error("보유 주식이 부족합니다.");

    const stock = stmtSelectStockPrice.get(symbol);
    if (!stock) throw new Error("존재하지 않는 종목입니다.");

    const totalGain = Math.round(stock.price * quantity);

    const user = stmtSelectUserMoney.get(userId);
    if (!user) throw new Error("가입되지 않은 사용자입니다.");

    stmtUpdateUserMoneyDelta.run(totalGain, userId);
    stmtUpdateHoldingSharesDelta.run(quantity, userId, symbol);

    if (holding.shares - quantity <= 0) {
      stmtDeleteHolding.run(userId, symbol);
    }
  });

  tx();

  cache.del(`portfolio:${userId}`);
  cache.del("leaderboard:stock_value:top10");
}

// ────────────────────────────────────────────────
// 임베드 생성 헬퍼 함수들
// ────────────────────────────────────────────────

const SPARK = "▁▂▃▄▅▆▇█";
/** 숫자 배열을 ▁▂▃▅▇ 형태의 미니 차트로 변환 */
function sparkline(values) {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return SPARK[3].repeat(values.length);
  return values
    .map((v) => SPARK[Math.min(7, Math.floor(((v - min) / (max - min)) * 8))])
    .join("");
}

function fmtPct(rate) {
  const pct = (rate * 100).toFixed(2);
  const arrow = rate > 0 ? "🔺" : rate < 0 ? "🔻" : "▬";
  return `${arrow} ${rate > 0 ? "+" : ""}${pct}%`;
}

/** 단붕 지수: 7종목 기준가 대비 평균 × 1000 */
function computeIndex(stocks, usePrev) {
  let sum = 0;
  let n = 0;
  for (const s of stocks) {
    const base = STOCKS[s.symbol]?.base;
    if (!base) continue;
    const p = usePrev ? s.last_price || s.price : s.price;
    sum += p / base;
    n += 1;
  }
  return n ? (sum / n) * 1000 : 0;
}

function createStockUpdateEmbed() {
  let stocks = cache.get("stocks:snapshotRows");
  if (!stocks) {
    stocks = stmtSelectStocksForEmbed.all();
    cache.set("stocks:snapshotRows", stocks, 30000);
  }

  const status = getMarketStatus();
  const regime = currentRegime();
  const idx = computeIndex(stocks, false);
  const prevIdx = computeIndex(stocks, true);
  const idxRate = prevIdx > 0 ? idx / prevIdx - 1 : 0;

  const embed = new EmbedBuilder()
    .setColor(0x00aa99)
    .setTitle("📈 주식 시장 시황")
    .setDescription(
      `**${status.label}** · 시장 분위기 ${regime.label}\n` +
        `📊 **단붕 지수 ${idx.toFixed(1)}** (${fmtPct(idxRate)})`,
    );

  stocks.forEach((s) => {
    const name = s.name || STOCKS[s.symbol]?.name || s.symbol;
    const prev = s.last_price || s.price;
    const rate = prev > 0 ? s.price / prev - 1 : 0;
    const limit = s.price >= Math.round(prev * (1 + DAILY_LIMIT)) ? " 🚫상한가" : s.price <= Math.max(Math.round(prev * (1 - DAILY_LIMIT)), 1) ? " 🚫하한가" : "";
    const hist = (s.history ? s.history.split(",").filter(Boolean).map(Number) : []).slice(-9);
    const chart = sparkline([...hist, s.price]);
    const range =
      s.day_high && s.day_low
        ? `고 ${s.day_high.toLocaleString()} · 저 ${s.day_low.toLocaleString()}`
        : "";

    embed.addFields({
      name: `${name} (${s.symbol.toUpperCase()})`,
      value:
        `**${s.price.toLocaleString()}원** ${fmtPct(rate)}${limit}\n` +
        (chart ? `\`${chart}\` ` : "") +
        range,
      inline: false,
    });
  });

  // 최근 뉴스
  let recentNews = cache.get("stocks:recentNews");
  if (!recentNews) {
    recentNews = stmtSelectRecentNews.get();
    cache.set("stocks:recentNews", recentNews || null, 30000);
  }

  if (recentNews?.last_news_title) {
    const time = new Date(recentNews.last_news_time * 1000);
    const timeStr = time.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Seoul",
    });
    embed.addFields({
      name: `📰 [${recentNews.name}] 최근 주요 뉴스`,
      value: `${recentNews.last_news_title}\n${timeStr}`,
      inline: false,
    });
  } else {
    embed.addFields({
      name: "📰 최근 주요 뉴스",
      value: "최근 뉴스가 없습니다.",
      inline: false,
    });
  }

  embed.setFooter({
    text: "전일 종가 대비 · 10분마다 갱신(장중) · 가격 제한폭 ±30%",
  });
  embed.setTimestamp();

  return embed;
}

function createMyStocksEmbed(userId, username) {
  const user = stmtSelectUserMoney.get(userId);

  let holdings = cache.get(`portfolio:${userId}`);
  if (!holdings) {
    holdings = stmtSelectHoldingsForUser.all(userId);
    cache.set(`portfolio:${userId}`, holdings, 15000);
  }

  let totalStockValue = 0;
  let totalProfit = 0;
  let totalBuyValue = 0;
  let stockLines = [];

  holdings.forEach((h) => {
    const currentVal = h.price * h.shares;
    const buyVal = h.avg_buy_price * h.shares;
    const profit = currentVal - buyVal;
    const profitRate =
      h.avg_buy_price > 0
        ? (((h.price - h.avg_buy_price) / h.avg_buy_price) * 100).toFixed(1)
        : "0.0";

    totalStockValue += currentVal;
    totalProfit += profit;
    totalBuyValue += buyVal;

    const changeArrow =
      h.avg_buy_price > 0 ? (profitRate >= 0 ? "🔺" : "🔻") : "🔹";
    const changeSign = h.avg_buy_price > 0 && profitRate >= 0 ? "+" : "";

    stockLines.push(
      `**${h.name} (${h.avg_buy_price.toLocaleString()}원)** : ${h.shares}주\n` +
        `└ 현재가: ${h.price.toLocaleString()}원 (${changeArrow}${changeSign}${profitRate}%)`,
    );
  });

  const totalProfitRate =
    totalBuyValue > 0
      ? ((totalProfit / totalBuyValue) * 100).toFixed(2)
      : "0.00";

  const rateArrow = totalProfit >= 0 ? "🔺" : "🔻";

  const totalText =
    `• 보유액: ${(user?.money || 0).toLocaleString()}원\n` +
    `• 주식 평가액: ${totalStockValue.toLocaleString()}원\n` +
    `• 총 수익률: ${rateArrow}${totalProfitRate}%\n` +
    `• 총 손익: ${totalProfit.toLocaleString()}원`;

  const embed = new EmbedBuilder()
    .setColor("#5865F2")
    .setTitle(`📜 ${username}님의 자산 현황`)
    .addFields(
      {
        name: "📊 자산 요약",
        value: totalText,
        inline: false,
      },
      {
        name: "━━━━━━━━━━━━━━━━━━━━━━━━",
        value:
          stockLines.length > 0
            ? stockLines.join("\n\n")
            : "보유한 주식이 없습니다.",
        inline: false,
      },
    );

  // footer 시간
  const now = new Date();
  const timeStr = now
    .toLocaleTimeString("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace("오전 ", "오전 ")
    .replace("오후 ", "오후 ");

  embed.setFooter({ text: `오늘 ${timeStr}` });

  return embed;
}

/** DB에 등록된 종목(이름·심볼) — 슬래시 자동완성용 */
function getStocksForAutocomplete() {
  return stmtSelectStocksForEmbed.all().map((s) => ({
    symbol: s.symbol,
    name: s.name || STOCKS[s.symbol]?.name || s.symbol,
  }));
}

module.exports = {
  TICK_MINUTES,
  isMarketOpen,
  getMarketStatus,
  updateStockPrices,
  buyStock,
  sellStock,
  STOCKS,
  createStockUpdateEmbed,
  createMyStocksEmbed,
  getStocksForAutocomplete,
};
