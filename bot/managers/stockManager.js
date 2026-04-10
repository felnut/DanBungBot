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
  "SELECT id, symbol, name, price, last_change, last_news_title, last_news_time FROM stocks ORDER BY id ASC",
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
  hys: { name: "한양반도체", base_t: 0.0012, news: 1.4 },
  ftc: { name: "퓨처캐피탈", base_t: 0.0008, news: 1.2 },
  djc: { name: "대진건설", base_t: 0.0006, news: 1.1 },
  hgf: { name: "한그린푸드", base_t: 0.0009, news: 1.3 },
  bhx: { name: "바이오헬릭스", base_t: 0.0018, news: 1.6 },
  msd: { name: "마이크로스터디", base_t: 0.001, news: 1.25 },
  sgmn: { name: "서재미나이", base_t: 0.0015, news: 1.45 },
};
//종목 끝

/**
 * 주가 랜덤 변동 + 뉴스 이벤트 적용
 * (주기적으로 호출됨 - 보통 setInterval로)
 */
async function updateStockPrices() {
  const nowSec = Math.floor(Date.now() / 1000);

  const tx = db.transaction(() => {
    const stocks = stmtSelectAllStocks.all();
    for (const stock of stocks) {
      const info = STOCKS[stock.symbol];
      if (!info) continue;

      // 기본 변동률 (가우시안 분포 비슷하게)
      let change = (Math.random() - 0.5) * 0.015;

      let news = null;
      if (Math.random() < 0.25) {
        news = getRandomNews(stock.symbol);
        if (news) {
          const impact =
            news.impactMin + Math.random() * (news.impactMax - news.impactMin);
          change += impact;
        }
      }

      const newPrice = Math.max(
        Math.round(stock.price * (1 + change)),
        Math.round(stock.price * 0.1),
      );

      if (news) {
        stmtUpdateStockWithNews.run(
          newPrice,
          change,
          news.title,
          nowSec,
          stock.symbol,
        );
      } else {
        stmtUpdateStockNoNews.run(newPrice, change, stock.symbol);
      }
    }
  });

  tx();

  // prices/news changed -> bust relevant caches
  cache.del("stocks:snapshotRows");
  cache.del("stocks:recentNews");
  cache.del("leaderboard:stock_value:top10");
}

/**
 * 종목별 랜덤 뉴스 가져오기
 */
function getRandomNews(symbol) {
  const pool = NEWS_POOL[symbol] || [];
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

function createStockUpdateEmbed() {
  let stocks = cache.get("stocks:snapshotRows");
  if (!stocks) {
    stocks = stmtSelectStocksForEmbed.all();
    cache.set("stocks:snapshotRows", stocks, 30000);
  }

  const embed = new EmbedBuilder()
    .setColor(0x00aa99)
    .setTitle("📈 주식 시장 실시간 시황");

  // 제목 후 구분선
  embed.addFields({
    name: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    value: "",
    inline: false,
  });

  // 종목 세로 배치
  stocks.forEach((s) => {
    const change = (s.last_change * 100).toFixed(1);
    const arrow = change >= 0 ? "🔺" : "🔻";
    const sign = change >= 0 ? "+" : "";
    const name = s.name || STOCKS[s.symbol]?.name || s.symbol;

    embed.addFields({
      name: '',
      value: `**${name} (${s.symbol.toUpperCase()})\n${arrow}${sign}${change}%\n${s.price.toLocaleString()}원**`,
      inline: false,
    });
  });

  // 주식 후 구분선
  embed.addFields({
    name: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    value: "",
    inline: false,
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
    });

    embed.addFields(
      {
        name: "**📰 최근 주요 뉴스**",
        value: "",
        inline: false,
      },
      {
        name: `[${recentNews.name}]`,
        value: `${recentNews.last_news_title}\n${timeStr}`,
        inline: false,
      },
    );
  } else {
    embed.addFields({
      name: "**📰 최근 주요 뉴스**",
      value: "최근 뉴스가 없습니다.",
      inline: false,
    });
  }

  // 뉴스 후 구분선
  embed.addFields({
    name: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    value: "",
    inline: false,
  });

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

  embed.setFooter({
    text: `💡 /주식 주가 로 상세 차트 확인 가능 • 실시간 갱신 • 오늘 ${timeStr}`,
  });

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

module.exports = {
  updateStockPrices,
  buyStock,
  sellStock,
  STOCKS,
  createStockUpdateEmbed,
  createMyStocksEmbed,
};
