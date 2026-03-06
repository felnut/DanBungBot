const db = require("../Database");
const { EmbedBuilder } = require("discord.js");

// 뉴스 시작
const NEWS_POOL = {
  nct: [
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
  hcp: [
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
  dac: [
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
  nct: {
    name: "네오코어 테크",
    base_t: 0.0012,
    news: 1.4,
  },
  hcp: {
    name: "단소 캐피탈",
    base_t: 0.0008,
    news: 1.2,
  },
  dac: {
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

let netBuy = {};

// 주가 뉴스
function createStockUpdateEmbed() {
  const now = Date.now();
  const prices = db
    .prepare("SELECT symbol, name, price, last_change FROM stocks")
    .all();

  const embed = new EmbedBuilder()
    .setTitle("📈 주식 시장 실시간 시황")
    .setThumbnail("https://cdn-icons-png.flaticon.com/512/4222/4222025.png")
    .setColor("#2f3136")
    .setTimestamp();

  prices.forEach((p) => {
    const changePercent = (p.last_change * 100).toFixed(1);
    const isPositive = p.last_change >= 0;
    const indicator = isPositive ? "🔺" : "🔻";

    embed.addFields({
      name: `${p.name}\n${indicator}${changePercent}%`,
      value: `**${p.price.toLocaleString()}원**`,
      inline: true,
    });
  });

  if (prices.length % 3 !== 0) {
    embed.addFields({ name: "\u200B", value: "\u200B", inline: true });
  }

  const recentNews = db
    .prepare(
      `
      SELECT name, last_news_title, last_news_time
      FROM stocks
      WHERE last_news_time > ?
      ORDER BY last_news_time DESC
      LIMIT 3
    `,
    )
    .all(now - 20000);

  if (recentNews.length > 0) {
    let newsContent = "";
    recentNews.forEach((item) => {
      newsContent += `- **[${item.name}]**\n  - ${item.last_news_title}\n`;
    });

    embed.addFields({
      name: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      value: "\u200B",
    });

    embed.addFields({
      name: "📰 최근 주요 뉴스",
      value: newsContent.trim(),
      inline: false,
    });
  } else {
    embed.addFields({
      name: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      value: "📢 **시장 소식**: 현재 특별한 뉴스 없습니다.",
    });
  }

  embed.setFooter({
    text: "💡Tip: `/주식 주가` 명령어로 상세 차트를 확인하세요.",
  });

  return embed;
}

async function updateStockPrices() {
  const now = Date.now();

  const newsEvent = Math.random() < 0.3;
  let newsTarget = null;

  if (newsEvent) {
    const symbols = Object.keys(STOCKS);
    newsTarget = symbols[Math.floor(Math.random() * symbols.length)];
  }

  for (const [symbol, info] of Object.entries(STOCKS)) {
    const row = db.prepare("SELECT * FROM stocks WHERE symbol = ?").get(symbol);
    if (!row) continue;

    let price = row.price;
    const prevReturn = row.prev_return || 0;
    let cooldown = row.cooldown_until || 0;

    let delta = info.base_t;
    delta += prevReturn * 0.4;
    delta += (Math.random() - 0.5) * 0.04;

    if (prevReturn < -0.1) delta += 0.08;

    if (symbol === newsTarget) {
      const newsList = NEWS_POOL[symbol];
      if (newsList && newsList.length > 0) {
        const selected = newsList[Math.floor(Math.random() * newsList.length)];

        let impact =
          selected.impactMin +
          Math.random() * (selected.impactMax - selected.impactMin);
        impact *= info.news;

        delta += impact;

        db.prepare(
          `
          UPDATE stocks
          SET last_news_title = ?, last_news_time = ?
          WHERE symbol = ?
        `,
        ).run(selected.title, now, symbol);

        console.log(
          `[${symbol.toUpperCase()}] 뉴스: ${selected.title} (${(impact * 100).toFixed(1)}%)`,
        );
      }
    }

    // 장대음봉 (0.3% + 쿨타임)
    if (Math.random() < 0.003 && now > cooldown) {
      delta = -(0.1 + Math.random() * 0.3);
      db.prepare("UPDATE stocks SET cooldown_until = ? WHERE symbol = ?").run(
        now + 24 * 60 * 60 * 1000,
        symbol,
      );
    }

    // 순매수 영향
    delta += (netBuy[symbol] || 0) * 0.0008;
    netBuy[symbol] = 0;

    delta = Math.max(Math.min(delta, 0.3), -0.3);

    const newPrice = Math.max(Math.round(price * (1 + delta)), 1000);

    db.prepare(
      `
      UPDATE stocks 
      SET price = ?, last_price = ?, last_change = ?, prev_return = ?
      WHERE symbol = ?
    `,
    ).run(newPrice, price, delta, delta, symbol);
  }
  console.log("주가 업데이트 완료");
}

// 매수 함수
function buyStock(userId, symbol, qty) {
  const stock = db.prepare("SELECT * FROM stocks WHERE symbol = ?").get(symbol);
  const user = db
    .prepare("SELECT money FROM user WHERE user_id = ?")
    .get(userId);

  if (!stock) throw new Error("존재하지 않는 종목입니다.");
  if (!user)
    throw new Error("가입되지 않은 유저입니다. `/돈`으로 가입해주세요.");

  const totalCost = Math.round(stock.price * qty);
  if (user.money < totalCost)
    throw new Error(
      `잔액이 부족합니다. (필요: ${totalCost.toLocaleString()}원)`,
    );

  // 트랜잭션으로 처리
  const transaction = db.transaction(() => {
    // 돈 차감
    db.prepare("UPDATE user SET money = money - ? WHERE user_id = ?").run(
      totalCost,
      userId,
    );

    // 주식 추가 및 평단가 갱신
    const pos = db
      .prepare("SELECT * FROM user_stocks WHERE user_id = ? AND symbol = ?")
      .get(userId, symbol);
    if (pos) {
      const newQty = pos.shares + qty;
      const newAvg = (pos.avg_buy_price * pos.shares + totalCost) / newQty;
      db.prepare(
        "UPDATE user_stocks SET shares = ?, avg_buy_price = ? WHERE user_id = ? AND symbol = ?",
      ).run(newQty, newAvg, userId, symbol);
    } else {
      db.prepare(
        "INSERT INTO user_stocks (user_id, symbol, shares, avg_buy_price) VALUES (?, ?, ?, ?)",
      ).run(userId, symbol, qty, stock.price);
    }

    // 시장가 영향 (순매수 강도 증가)
    netBuy[symbol] = (netBuy[symbol] || 0) + qty;
  });

  transaction();
  return true;
}

// 주식 매도 함수
function sellStock(userId, symbol, qty) {
  const pos = db
    .prepare("SELECT * FROM user_stocks WHERE user_id = ? AND symbol = ?")
    .get(userId, symbol);
  const stock = db.prepare("SELECT * FROM stocks WHERE symbol = ?").get(symbol);

  if (!pos || pos.shares < qty) throw new Error("보유 수량이 부족합니다.");

  const totalRevenue = Math.round(stock.price * qty);

  const transaction = db.transaction(() => {
    // 주식 차감
    if (pos.shares === qty) {
      db.prepare(
        "DELETE FROM user_stocks WHERE user_id = ? AND symbol = ?",
      ).run(userId, symbol);
    } else {
      db.prepare(
        "UPDATE user_stocks SET shares = shares - ? WHERE user_id = ? AND symbol = ?",
      ).run(qty, userId, symbol);
    }

    // 돈 지급
    db.prepare("UPDATE user SET money = money + ? WHERE user_id = ?").run(
      totalRevenue,
      userId,
    );

    // 시장가 영향 (순매수 강도 감소)
    netBuy[symbol] = (netBuy[symbol] || 0) - qty;
  });

  transaction();
  return true;
}

// 자산 확인 임베드
function createMyStocksEmbed(userId, username) {
  const user = db
    .prepare("SELECT money FROM user WHERE user_id = ?")
    .get(userId);

  const holdings = db
    .prepare(
      `
      SELECT us.*, s.name, s.price 
      FROM user_stocks us 
      JOIN stocks s ON us.symbol = s.symbol 
      WHERE us.user_id = ?
    `,
    )
    .all(userId);

  const embed = new EmbedBuilder()
    .setTitle(`📜 ${username}님의 자산 현황`)
    .setColor("#5865F2")
    .setTimestamp();

  let totalStockValue = 0;
  let totalProfit = 0;
  let totalBuyValue = 0;
  let stockListText = "";

  if (holdings.length === 0) {
    stockListText = "보유한 주식이 없습니다.";
  } else {
    holdings.forEach((h) => {
      const currentVal = h.price * h.shares;
      const buyVal = h.avg_buy_price * h.shares;
      const profit = currentVal - buyVal;
      const profitRate = (
        ((h.price - h.avg_buy_price) / h.avg_buy_price) *
        100
      ).toFixed(1);

      totalStockValue += currentVal;
      totalProfit += profit;
      totalBuyValue += buyVal;

      const sign = profit >= 0 ? "🔺" : "🔻";

      stockListText += `**${h.name} (${h.avg_buy_price.toLocaleString()}원)** : ${h.shares}주
└ 현재가: ${h.price.toLocaleString()}원 (${sign}${profitRate}%)
`;
    });
  }

  const totalProfitRate =
    totalBuyValue > 0
      ? ((totalProfit / totalBuyValue) * 100).toFixed(2)
      : "0.00";

  const rateArrow = totalProfit >= 0 ? "🔺" : "🔻";

  const totalText = `• 보유액: ${(user?.money || 0).toLocaleString()}원
• 주식 평가액: ${totalStockValue.toLocaleString()}원
• 총 수익률: ${rateArrow}${totalProfitRate}%
• 총 손익: ${totalProfit.toLocaleString()}원`;

  embed.addFields(
    {
      name: "📊 자산 요약",
      value: totalText,
    },
    {
      name: "━━━━━━━━━━━━━━━━━━━━━━━━",
      value: stockListText,
    },
  );

  return embed;
}

// export 업데이트
module.exports = {
  updateStockPrices,
  buyStock,
  sellStock,
  STOCKS,
  createStockUpdateEmbed,
  createMyStocksEmbed,
};
