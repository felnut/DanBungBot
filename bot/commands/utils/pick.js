const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const crypto = require("node:crypto");

const MAX_ITEMS = 50;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("추첨")
    .setDescription("항목 중에서 무작위로 뽑아줘요! (쉼표로 구분)")
    .addStringOption((o) =>
      o
        .setName("항목")
        .setDescription("예: 짜장, 짬뽕, 볶음밥")
        .setRequired(true)
        .setMaxLength(500),
    )
    .addIntegerOption((o) =>
      o
        .setName("개수")
        .setDescription("뽑을 개수 (기본 1)")
        .setMinValue(1)
        .setMaxValue(MAX_ITEMS),
    ),

  async execute(interaction) {
    const items = interaction.options
      .getString("항목")
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length < 2) {
      return interaction.reply({
        content: "❌ 항목을 쉼표(,)로 구분해 2개 이상 입력해 주세요.",
        flags: MessageFlags.Ephemeral,
      });
    }
    if (items.length > MAX_ITEMS) {
      return interaction.reply({
        content: `❌ 항목은 최대 ${MAX_ITEMS}개까지예요.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    const count = Math.min(
      interaction.options.getInteger("개수") ?? 1,
      items.length,
    );

    // Fisher-Yates 셔플 (암호학적 난수)
    const pool = [...items];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked = pool.slice(0, count);
    return interaction.reply(
      `🎲 ${items.length}개 중 ${count}개 추첨 결과\n${picked.map((p, i) => `${i + 1}. **${p.slice(0, 100)}**`).join("\n")}`,
    );
  },
};
