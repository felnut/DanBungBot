const db = require("../../Database");
const { EmbedBuilder } = require("discord.js");

// 기본 정보 (고정값)
// 뉴스 시작
const NEWS_POOL = {
  sam: [
    {
      title: "차세대 양자 보안 칩셋 세계 최초 상용화 성공.",
      impactMin: 0.15,
      impactMax: 0.3,
    },
    {
      title: "글로벌 클라우드 기업과 7년 독점 공급 계약 체결.",
      impactMin: 0.05,
      impactMax: 0.15,
    },
    {
      title: "주요 파운드리 공정 수율 문제로 신제품 출시 8개월 연기.",
      impactMin: -0.1,
      impactMax: -0.2,
    },
    {
      title: "핵심 R&D 인력 40% 동시 퇴사 및 연구 중단 위기.",
      impactMin: -0.03,
      impactMax: -0.1,
    },
  ],
  dsc: [
    {
      title: "디지털 자산 담보 대출 서비스 3개월 만에 10조 원 돌파.",
      impactMin: 0.15,
      impactMax: 0.3,
    },
    {
      title: "중소기업 전용 저금리 정책자금 대출 위탁운용사 선정.",
      impactMin: 0.05,
      impactMax: 0.15,
    },
    {
      title: "대규모 연체율 급등 및 부실채권 2조 원 추가 적립 요구.",
      impactMin: -0.1,
      impactMax: -0.2,
    },
    {
      title: "금융당국 전자금융거래법 위반으로 과징금 500억 원 부과.",
      impactMin: -0.03,
      impactMax: -0.1,
    },
  ],
  dab: [
    {
      title: "정부 주도 GTX-B/C 연장 구간 시공 우선협상대상자 선정.",
      impactMin: 0.15,
      impactMax: 0.3,
    },
    {
      title: "해외 플랜트 공사 수주 1조 2천억 원 규모 계약 체결.",
      impactMin: 0.05,
      impactMax: 0.15,
    },
    {
      title: "원자재 가격 폭등과 노사 갈등 장기화로 GTX 공사 연기.",
      impactMin: -0.1,
      impactMax: -0.2,
    },
    {
      title: "건설 현장 사고 발생으로 공사 중지 및 벌금 부과.",
      impactMin: -0.03,
      impactMax: -0.1,
    },
  ],
  gpf: [
    {
      title: "K-푸드 열풍으로 북미·동남아 수출액 전년 대비 180% 급증.",
      impactMin: 0.15,
      impactMax: 0.3,
    },
    {
      title: "친환경 대체육 신제품 출시 후 편의점까지 확장.",
      impactMin: 0.05,
      impactMax: 0.15,
    },
    {
      title: "곡물·육류 원재료 가격 급등과 공급망 차질 장기화.",
      impactMin: -0.1,
      impactMax: -0.2,
    },
    {
      title: "일부 제품에서 이물질 검출 논란 발생, 리콜 진행.",
      impactMin: -0.03,
      impactMax: -0.1,
    },
  ],
  hlxm: [
    {
      title: "mRNA 기반 범암 면역치료제 3상 임상 결과 긍정 발표.",
      impactMin: 0.2,
      impactMax: 0.35,
    },
    {
      title:
        "희귀질환 유전자 치료제 FDA 신속 심사 대상 지정. 빠르게 통과할 것으로 예상",
      impactMin: 0.05,
      impactMax: 0.15,
    },
    {
      title: "주력 신약 후보물질 임상 실패 및 개발 지연.",
      impactMin: -0.15,
      impactMax: -0.3,
    },
    {
      title: "특허 무효 소송 패소로 연간 로열티 800억 원 지급 판결.",
      impactMin: -0.05,
      impactMax: -0.12,
    },
  ],
};
// 뉴스 끝

// 종목 시작
const STOCKS = {
  sam: {
    name: "샘숭",
    base_t: 0.0012,
    news: 1.4,
  },
  dsc: {
    name: "단소 캐피탈",
    base_t: 0.0008,
    news: 1.2,
  },
  dab: {
    name: "동아 건설",
    base_t: 0.0006,
    news: 1.1,
  },
  gpf: {
    name: "그린팜 푸드",
    base_t: 0.0009,
    news: 1.3,
  },
  hlxm: {
    name: "헬릭시온 메디컬",
    base_t: 0.0018,
    news: 1.6,
  },
};
//종목 끝

/**
 * 주가 랜덤 변동 + 뉴스 이벤트 적용
 * (주기적으로 호출됨 - 보통 setInterval로)
 */
async function updateStockPrices() {
  const stocks = db.prepare("SELECT * FROM stocks").all();

  for (const stock of stocks) {
    const info = STOCKS[stock.symbol];
    if (!info) continue;

    // 기본 변동률 (가우시안 분포 비슷하게)
    let change = (Math.random() - 0.5) * 0.015; // volatility 없으면 임시로 1.5% 정도로

    let news = null;

    // 뉴스 이벤트 적용 (25% 확률)
    if (Math.random() < 0.25) {
      news = getRandomNews(stock.symbol);
      if (news) {
        const impact =
          news.impactMin + Math.random() * (news.impactMax - news.impactMin);
        change += impact;
      }
    }

    // 새로운 가격 계산 (최소 10% 이하로는 안 떨어지게)
    const newPrice = Math.max(
      Math.round(stock.price * (1 + change)),
      Math.round(stock.price * 0.1), // base_price가 없으면 현재 가격 기준
    );

    let query = `UPDATE stocks SET price = ?, last_change = ?`;
    let params = [newPrice, change];

    if (news) {
      query += `, last_news_title = ?, last_news_time = ?`;
      params.push(news.title, Math.floor(Date.now() / 1000));
    }

    query += ` WHERE symbol = ?`;
    params.push(stock.symbol);

    db.prepare(query).run(...params);
  }
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
  const stock = db
    .prepare("SELECT price FROM stocks WHERE symbol = ?")
    .get(symbol);
  if (!stock) throw new Error("존재하지 않는 종목입니다.");

  const totalCost = Math.round(stock.price * quantity);

  const user = db
    .prepare("SELECT money FROM user WHERE user_id = ?")
    .get(userId);
  if (user.money < totalCost) throw new Error("잔액이 부족합니다.");

  db.prepare("UPDATE user SET money = money - ? WHERE user_id = ?").run(
    totalCost,
    userId,
  );

  // 이미 보유 중인지 확인 후 INSERT or UPDATE
  const existing = db
    .prepare(
      "SELECT shares, avg_buy_price FROM user_stocks WHERE user_id = ? AND symbol = ?",
    )
    .get(userId, symbol);

  if (existing) {
    // 추가 매수 → 평단가 재계산
    const newShares = existing.shares + quantity;
    const newAvg =
      (existing.avg_buy_price * existing.shares + totalCost) / newShares;

    db.prepare(
      "UPDATE user_stocks SET shares = ?, avg_buy_price = ? WHERE user_id = ? AND symbol = ?",
    ).run(newShares, newAvg, userId, symbol);
  } else {
    // 최초 매수
    db.prepare(
      "INSERT INTO user_stocks (user_id, symbol, shares, avg_buy_price) VALUES (?, ?, ?, ?)",
    ).run(userId, symbol, quantity, stock.price);
  }
}

function sellStock(userId, symbol, quantity) {
  const holding = db
    .prepare("SELECT shares FROM user_stocks WHERE user_id = ? AND symbol = ?")
    .get(userId, symbol);
  if (!holding || holding.shares < quantity)
    throw new Error("보유 주식이 부족합니다.");

  const stock = db
    .prepare("SELECT price FROM stocks WHERE symbol = ?")
    .get(symbol);
  const totalGain = stock.price * quantity;

  db.prepare("UPDATE user SET money = money + ? WHERE user_id = ?").run(
    totalGain,
    userId,
  );
  db.prepare(
    "UPDATE user_stocks SET shares = shares - ? WHERE user_id = ? AND symbol = ?",
  ).run(quantity, userId, symbol);

  // 0주 되면 레코드 삭제 (선택사항)
  if (holding.shares - quantity <= 0) {
    db.prepare("DELETE FROM user_stocks WHERE user_id = ? AND symbol = ?").run(
      userId,
      symbol,
    );
  }
}

// ────────────────────────────────────────────────
// 임베드 생성 헬퍼 함수들
// ────────────────────────────────────────────────

function createStockUpdateEmbed() {
  const stocks = db
    .prepare(
      "SELECT symbol, name, price, last_change, last_news_title, last_news_time FROM stocks ORDER BY symbol",
    )
    .all();

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

    embed.addFields({
      name: '',
      value: `${s.name || STOCKS[s.symbol]?.name || s.symbol}\n${arrow}${sign}${change}%\n${s.price.toLocaleString()}원`,
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
  const recentNews = db
    .prepare(
      `
      SELECT name, last_news_title, last_news_time 
      FROM stocks 
      WHERE last_news_title IS NOT NULL 
      ORDER BY last_news_time DESC 
      LIMIT 1
    `,
    )
    .get();

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
  const user = db
    .prepare("SELECT money FROM user WHERE user_id = ?")
    .get(userId);

  const holdings = db
    .prepare(
      `
      SELECT us.*, s.name, s.price, s.last_change
      FROM user_stocks us 
      JOIN stocks s ON us.symbol = s.symbol 
      WHERE us.user_id = ?
    `,
    )
    .all(userId);

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
