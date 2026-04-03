const { SlashCommandBuilder } = require("@discordjs/builders");
const { EmbedBuilder } = require("discord.js");
const {
  updateStockPrices,
  buyStock,
  sellStock,
  STOCKS,
  createStockUpdateEmbed,
  createMyStocksEmbed,
} = require("../../managers/stockManager");
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

    // ====================== 주가 확인 ======================
    if (sub === "주가") {
      const embed = createStockUpdateEmbed();
      return interaction.editReply({ embeds: [embed] });
    }

    // ====================== 매수 / 매도 ======================
    if (sub === "매수" || sub === "매도") {
      const symbol = interaction.options.getString("종목");
      const qty = interaction.options.getInteger("수량");

      try {
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
    // ====================== 내 주식 ======================
    if (sub === "내주식") {
      const embed = createMyStocksEmbed(interaction.user.id, interaction.user.username);
      return interaction.editReply({ embeds: [embed] });
    }
    // ====================== 내 주식 ======================
    if (sub === "랭킹") {
      const users = db
        .prepare(
          `SELECT u.user_id, 
          COALESCE(SUM(us.shares * s.price), 0) as stock_value 
          FROM user u 
          LEFT JOIN user_stocks us 
          ON u.user_id = us.user_id 
          LEFT JOIN stocks s 
          ON us.symbol = s.symbol 
          GROUP BY u.user_id 
          HAVING stock_value > 0 
          ORDER BY stock_value DESC 
          LIMIT 10
      `,
        )
        .all();

      const embed = {
        color: 0xffd700, // 금색
        title: "🏆 서버 주식 보유액 랭킹 TOP 10 🏆",
        description: "실시간 보유 주식 평가액 순위",
        fields: [],
        footer: {
          text: "• 0원 보유자는 제외",
        },
        timestamp: new Date(),
      };

      if (users.length === 0) {
        embed.description = "아직 주식을 보유한 분이 없네요... 😅";
        embed.color = 0x7289da; // 블루로 살짝 변경
      } else {
        let rankingText = "";
        users.forEach((u, i) => {
          const rankEmoji =
            i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
          rankingText += `${rankEmoji} <@${u.user_id}> **${u.stock_value.toLocaleString()}원**\n`;
        });

        embed.fields.push({
          name: "순위",
          value: rankingText || "아직 데이터가 없어요",
          inline: false,
        });
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // ====================== 주가 강제 업데이트 (관리자 전용) ======================
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
