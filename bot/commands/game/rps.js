const { SlashCommandBuilder } = require("discord.js");
const {
  MIN_BET,
  TOTAL,
  pickWeighted,
  play,
} = require("../../managers/instantGame");

// 이김 32% · 비김 30% · 짐 38% → 환수율 (0.32×2 + 0.30×1) = 94%
const OUTCOMES = [
  { key: "win", weight: 0.32 * TOTAL, mult: 2 },
  { key: "draw", weight: 0.3 * TOTAL, mult: 1 },
  { key: "lose", weight: 0.38 * TOTAL, mult: 0 },
];
const HANDS = { rock: "✊ 바위", paper: "✋ 보", scissors: "✌️ 가위" };
const BEATS = { rock: "scissors", scissors: "paper", paper: "rock" }; // 키가 값을 이긴다

module.exports = {
  data: new SlashCommandBuilder()
    .setName("가위바위보")
    .setDescription("봇과 가위바위보! 이기면 2배, 비기면 본전, 지면 잃어요")
    .addStringOption((o) =>
      o
        .setName("선택")
        .setDescription("무엇을 낼까요?")
        .setRequired(true)
        .addChoices(
          { name: "✌️ 가위", value: "scissors" },
          { name: "✊ 바위", value: "rock" },
          { name: "✋ 보", value: "paper" },
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
    const mine = interaction.options.getString("선택");
    const bet = interaction.options.getInteger("금액");
    return play(
      interaction,
      bet,
      () => {
        const out = pickWeighted(OUTCOMES);
        // 결과에 맞는 봇의 손을 고른다
        const bot =
          out.key === "draw"
            ? mine
            : out.key === "win"
              ? BEATS[mine]
              : Object.keys(BEATS).find((h) => BEATS[h] === mine);
        return { ...out, bot };
      },
      (o) => ({
        title:
          o.key === "win"
            ? "🎉 이겼어요!"
            : o.key === "draw"
              ? "🤝 비겼어요"
              : "😢 졌어요...",
        description: `👤 나 **${HANDS[mine]}**\n🤖 봇 **${HANDS[o.bot]}**`,
      }),
    );
  },
};
