const { SlashCommandBuilder } = require("@discordjs/builders");
const { EmbedBuilder } = require("discord.js");
const {
  updateStockPrices,
  buyStock,
  sellStock,
  STOCKS,
  createStockUpdateEmbed,
  createMyStocksEmbed,
} = require("../../stockManager");
const db = require("../../../Database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("주식")
    .setDescription("서버 실시간 주식 거래소")
    .addSubcommand((sub) =>
      sub.setName("주가").setDescription("현재 주가 확인"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("매수")
        .setDescription("주식 사기")
        .addStringOption((opt) =>
          opt
            .setName("종목")
            .setDescription("종목명")
            .setRequired(true)
            .addChoices(
              ...Object.keys(STOCKS).map((k) => ({
                name: STOCKS[k].name,
                value: k,
              })),
            ),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("수량")
            .setDescription("수량")
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("매도")
        .setDescription("주식 팔기")
        .addStringOption((opt) =>
          opt
            .setName("종목")
            .setDescription("종목명")
            .setRequired(true)
            .addChoices(
              ...Object.keys(STOCKS).map((k) => ({
                name: STOCKS[k].name,
                value: k,
              })),
            ),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("수량")
            .setDescription("수량")
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("내주식").setDescription("내 자산 확인"),
    )
    .addSubcommand((sub) =>
      sub.setName("랭킹").setDescription("서버 자산가 순위"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("업데이트")
        .setDescription("테스트용 주가 업데이트 (관리자만)"),
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const sub = interaction.options.getSubcommand();

    if (sub === "주가") {
      const prices = db
        .prepare("SELECT name, price, last_change FROM stocks")
        .all();
      let msg = "━━━ 📈 현재 주가 📈 ━━━\n";
      prices.forEach((p) => {
        const change = (p.last_change * 100).toFixed(1);
        msg += `🔹 ${p.name} : ${p.price.toLocaleString()}원 (${change >= 0 ? "🔺" : "🔻"} ${change}%)\n`;
      });
      return interaction.editReply(msg);
    }

    if (sub === "매수" || sub === "매도") {
      const symbol = interaction.options.getString("종목");
      const qty = interaction.options.getInteger("수량");
      try {
        const result =
          sub === "매수"
            ? buyStock(interaction.user.id, symbol, qty)
            : sellStock(interaction.user.id, symbol, qty);

        const portfolioEmbed = createMyStocksEmbed(
          interaction.user.id,
          interaction.user.username,
        );

        return interaction.editReply({
          content: `✅ **${STOCKS[symbol].name} ${sub} 완료!**`,
          embeds: [portfolioEmbed],
        });
      } catch (e) {
        return interaction.editReply(`❌ ${e.message}`);
      }
    }

    if (sub === "내주식") {
      const embed = createMyStocksEmbed(
        interaction.user.id,
        interaction.user.username,
      );
      return interaction.editReply({ embeds: [embed] });
    }

    // if (sub === "내주식") {
    //   const holdings = db
    //     .prepare("SELECT * FROM user_stocks WHERE user_id = ?")
    //     .all(interaction.user.id);
    //   if (!holdings.length) return interaction.editReply("아직 주식 없습니다.");

    //   let totalProfit = 0;
    //   let totalBuyAmount = 0;
    //   let totalCurrentAmount = 0;
    //   let totalShares = 0;

    //   const embed = new EmbedBuilder()
    //     .setTitle(
    //       `━━━━━━━━━ 📜 ${interaction.user.username}님의 자산 ━━━━━━━━━`,
    //     )
    //     .setColor("#00FF00")
    //     .setTimestamp();

    //   // 합계 계산
    //   holdings.forEach((h) => {
    //     const current = db
    //       .prepare("SELECT price FROM stocks WHERE symbol = ?")
    //       .get(h.symbol);

    //     const buyAmount = Math.round(h.avg_buy_price * h.shares);
    //     const currentAmount = Math.round(current.price * h.shares);
    //     const profit = Math.round((current.price - h.avg_buy_price) * h.shares);

    //     totalBuyAmount += buyAmount;
    //     totalCurrentAmount += currentAmount;
    //     totalProfit += profit;
    //     totalShares += h.shares;
    //   });

    //   // 총 수익률 % 계산 + 표시 기호 결정
    //   const totalProfitRate =
    //     totalBuyAmount > 0
    //       ? ((totalProfit / totalBuyAmount) * 100).toFixed(1)
    //       : "0.0";

    //   let totalSign = "";
    //   if (totalProfit > 0) totalSign = "🔺";
    //   else if (totalProfit < 0) totalSign = "🔻";
    //   else totalSign = "🔹";

    //   // 합계 필드
    //   embed.addFields({
    //     name: "💰 합계",
    //     value:
    //       `총 금액: ${totalCurrentAmount.toLocaleString()}원\n` +
    //       `총 수익률: ${totalProfit.toLocaleString()}원(${totalSign}${totalProfitRate}%)\n` +
    //       `총 자산: ${totalShares}주`,
    //     inline: false,
    //   });

    //   embed.addFields({
    //     name: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    //     value: " ",
    //     inline: false,
    //   });

    //   // 종목별 필드
    //   holdings.forEach((h) => {
    //     const current = db
    //       .prepare("SELECT price FROM stocks WHERE symbol = ?")
    //       .get(h.symbol);

    //     const buyPrice = h.avg_buy_price.toLocaleString();
    //     const currentPrice = current.price.toLocaleString();
    //     const profitRate = (
    //       ((current.price - h.avg_buy_price) / h.avg_buy_price) *
    //       100
    //     ).toFixed(1);
    //     const profit = Math.round((current.price - h.avg_buy_price) * h.shares);

    //     let sign = "";
    //     if (profitRate > 0) sign = "🔺";
    //     else if (profitRate < 0) sign = "🔻";
    //     else sign = "🔹";

    //     embed.addFields({
    //       name: `${STOCKS[h.symbol].name}(구매가 ${buyPrice}원)`,
    //       value:
    //         `  - 현재가: ${currentPrice}원\n` +
    //         `  - 수익률: ${profit.toLocaleString()}원(${sign}${profitRate}%)\n` +
    //         `  - 구매량: ${h.shares}주`,
    //       inline: false,
    //     });
    //   });

    //   embed.addFields({
    //     name: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    //     value: " ",
    //     inline: false,
    //   });

    //   // footer 타임스탬프
    //   const now = new Date().toLocaleString("ko-KR", {
    //     timeZone: "Asia/Seoul",
    //     year: "numeric",
    //     month: "long",
    //     day: "numeric",
    //     weekday: "long",
    //     hour: "numeric",
    //     minute: "numeric",
    //     hour12: true,
    //   });
    //   embed.setFooter({ text: now });

    //   return interaction.editReply({ embeds: [embed] });
    // }

    if (sub === "랭킹") {
      const users = db
        .prepare(
          `
        SELECT u.user_id, u.money,
        COALESCE(SUM(us.shares * s.price), 0) as stock_value
        FROM user u
        LEFT JOIN user_stocks us ON u.user_id = us.user_id
        LEFT JOIN stocks s ON us.symbol = s.symbol
        GROUP BY u.user_id
        ORDER BY (u.money + stock_value) DESC LIMIT 10
      `,
        )
        .all();

      let msg = "🏆 서버 자산가 순위 🏆\n\n";
      users.forEach((u, i) => {
        msg += `${i + 1}. <@${u.user_id}> - ${(u.money + u.stock_value).toLocaleString()}원\n`;
      });
      return interaction.editReply(msg);
    }

    if (sub === "업데이트") {
      if (!interaction.member.permissions.has("ADMINISTRATOR")) {
        return interaction.editReply("❌ 관리자만 쓸 수 있습니다.");
      }
      try {
        await updateStockPrices();
        const updateEmbed = createStockUpdateEmbed();
        return interaction.editReply({
          content: "✅ 주가 업데이트 완료!",
          embeds: [updateEmbed],
        });
      } catch (e) {
        return interaction.editReply(`❌ 업데이트 중 오류: ${e.message}`);
      }
    }
  },
};
