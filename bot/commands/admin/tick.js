const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const {
  updateStockPrices,
  createStockUpdateEmbed,
} = require("../../managers/stockManager");
const cache = require("../utils/cache");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("시세갱신")
    .setDescription("[관리자 전용] 주가를 한 틱 강제로 갱신합니다 (테스트용)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // 관리자에게만 보임
    .setDMPermission(false),

  async execute(interaction) {
    // 전역 경제에 영향을 주므로 보이는 범위와 별개로 봇 주인(OWNER_ID)만 실행 가능
    if (!process.env.OWNER_ID || interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({
        content: "❌ 봇 주인만 쓸 수 있어요.",
        flags: MessageFlags.Ephemeral,
      });
    }
    try {
      await updateStockPrices({ force: true });
      cache.del("leaderboard:stock_value:top10");
      return interaction.reply({
        content: "✅ 주가 업데이트 완료!",
        embeds: [createStockUpdateEmbed()],
      });
    } catch (e) {
      console.error("시세 갱신 오류:", e.message);
      return interaction.reply({
        content: `❌ 업데이트 중 오류: ${e.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
