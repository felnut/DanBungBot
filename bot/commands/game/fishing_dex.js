const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database");
const { FISH, RODS } = require("../../managers/fishData");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("낚시도감")
    .setDescription("지금까지 잡은 물고기를 도감으로 확인해요"),

  async execute(interaction) {
    const userId = interaction.user.id;
    if (!db.prepare("SELECT 1 FROM user WHERE user_id = ?").get(userId)) {
      return interaction.reply({
        content: "먼저 `/게임 가입`으로 가입해주세요!",
        flags: MessageFlags.Ephemeral,
      });
    }
    const counts = new Map(
      db
        .prepare("SELECT fish, count FROM fish_log WHERE user_id = ?")
        .all(userId)
        .map((r) => [r.fish, r.count]),
    );
    const rod =
      db.prepare("SELECT rod FROM fishing_gear WHERE user_id = ?").get(userId)
        ?.rod ?? 0;
    const best = new Map(
      db
        .prepare("SELECT fish, cm FROM fish_best WHERE user_id = ?")
        .all(userId)
        .map((r) => [r.fish, r.cm]),
    );
    const caught = FISH.filter((f) => counts.has(f.key)).length;
    const lines = FISH.map((f) => {
      const n = counts.get(f.key);
      if (n)
        return `${f.name} · **${n.toLocaleString()}마리** (${f.mult}배)${best.has(f.key) ? ` · 최대 ${best.get(f.key)}cm` : ""}`;
      return f.rod > rod
        ? `🔒 ${RODS[f.rod].name}가 있으면 만날 수 있어요`
        : "❔ 아직 못 잡았어요";
    });
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const embed = new EmbedBuilder()
      .setColor(caught === FISH.length ? 0xffd700 : 0x3498db)
      .setTitle(
        `📖 ${interaction.user.username}님의 낚시 도감 (${caught}/${FISH.length})`,
      )
      .setDescription(
        `${lines.join("\n")}\n\n총 **${total.toLocaleString()}마리**를 낚았어요${caught === FISH.length ? "\n🎉 도감을 모두 채웠어요!" : ""}`,
      )
      .setFooter({ text: `내 낚싯대: ${RODS[rod].name}` });
    return interaction.reply({ embeds: [embed] });
  },
};
