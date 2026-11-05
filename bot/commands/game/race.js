const { SlashCommandBuilder } = require("discord.js");
const crypto = require("node:crypto");
const {
  MIN_BET,
  TOTAL,
  pickWeighted,
  play,
} = require("../../managers/instantGame");

// 우승 확률 × 배당 ≈ 0.94 → 환수율 94%
const ANIMALS = [
  { key: "cheetah", name: "🐆 치타", weight: 0.4 * TOTAL, mult: 2.35 },
  { key: "fox", name: "🦊 여우", weight: 0.3 * TOTAL, mult: 3.13 },
  { key: "rabbit", name: "🐇 토끼", weight: 0.2 * TOTAL, mult: 4.7 },
  { key: "turtle", name: "🐢 거북이", weight: 0.1 * TOTAL, mult: 9.4 },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("동물경주")
    .setDescription("우승할 동물에 걸어요! 확률이 낮을수록 배당이 커요")
    .addStringOption((o) =>
      o
        .setName("동물")
        .setDescription("누가 우승할까요?")
        .setRequired(true)
        .addChoices(
          ...ANIMALS.map((a) => ({
            name: `${a.name} (우승 ${Math.round((a.weight / TOTAL) * 100)}% · ${a.mult}배)`,
            value: a.key,
          })),
        ),
    )
    .addIntegerOption((o) =>
      o
        .setName("금액")
        .setDescription("베팅할 금액")
        .setRequired(true)
        .setMinValue(MIN_BET),
    ),

  async execute(interaction) {
    const pick = interaction.options.getString("동물");
    const bet = interaction.options.getInteger("금액");
    return play(
      interaction,
      bet,
      () => {
        const winner = pickWeighted(ANIMALS);
        const rest = ANIMALS.filter((a) => a !== winner);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = crypto.randomInt(i + 1);
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        return {
          winner,
          order: [winner, ...rest],
          mult: winner.key === pick ? winner.mult : 0,
        };
      },
      (o) => ({
        title: o.mult ? "🏆 내 동물이 우승!" : "😢 아쉽게 졌어요...",
        description: `🏁 결과\n${o.order.map((a, i) => `${["🥇", "🥈", "🥉", "4️⃣"][i]} ${a.name}${a.key === pick ? " ← 내 선택" : ""}`).join("\n")}`,
      }),
    );
  },
};
