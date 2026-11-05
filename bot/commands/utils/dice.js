const { SlashCommandBuilder } = require("discord.js");
const crypto = require("node:crypto");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("주사위")
    .setDescription("주사위를 굴려요! (기본: 6면 주사위 1개)")
    .addIntegerOption((o) =>
      o
        .setName("개수")
        .setDescription("굴릴 주사위 개수 (기본 1, 최대 20)")
        .setMinValue(1)
        .setMaxValue(20),
    )
    .addIntegerOption((o) =>
      o
        .setName("면")
        .setDescription("주사위 면의 수 (기본 6, 최대 1000)")
        .setMinValue(2)
        .setMaxValue(1000),
    ),

  async execute(interaction) {
    const count = interaction.options.getInteger("개수") ?? 1;
    const sides = interaction.options.getInteger("면") ?? 6;
    const rolls = Array.from({ length: count }, () =>
      crypto.randomInt(1, sides + 1),
    );
    const sum = rolls.reduce((a, b) => a + b, 0);
    const detail =
      count > 1 ? `\n${rolls.join(" + ")} = **${sum.toLocaleString()}**` : "";
    return interaction.reply(
      `🎲 **${count}d${sides}** 결과: ${count === 1 ? `**${rolls[0]}**` : rolls.map((r) => `\`${r}\``).join(" ")}${detail}`,
    );
  },
};
