const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const crypto = require("node:crypto");
const db = require("../../../Database");
const { getUserOrFail } = require("../utils/user");
const cache = require("../utils/cache");

// 아메리칸 룰렛: 0, 00, 1~36 (38칸).
// 1:1 배당(색)은 18/38 × 2 = 94.7%, 숫자 맞히기는 1/38 × 36 = 94.7% → 환수율 약 94.7%
const MIN_BET = 10;
const RED = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);
const DOUBLE_ZERO = 37; // 00

const nameOf = (n) => (n === DOUBLE_ZERO ? "00" : String(n));
const colorOf = (n) =>
  n === 0 || n === DOUBLE_ZERO ? "초록" : RED.has(n) ? "빨강" : "검정";
const emojiOf = (n) => ({ 초록: "🟩", 빨강: "🟥", 검정: "⬛" })[colorOf(n)];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("룰렛")
    .setDescription("룰렛! 색은 2배, 숫자를 맞히면 36배 (0과 00이 있어요)")
    .addStringOption((o) =>
      o
        .setName("종류")
        .setDescription("무엇에 걸까요?")
        .setRequired(true)
        .addChoices(
          { name: "🟥 빨강 (2배)", value: "red" },
          { name: "⬛ 검정 (2배)", value: "black" },
          { name: "숫자 (36배)", value: "number" },
        ),
    )
    .addIntegerOption((o) =>
      o
        .setName("금액")
        .setDescription("베팅할 금액")
        .setRequired(true)
        .setMinValue(MIN_BET),
    )
    .addIntegerOption((o) =>
      o
        .setName("숫자")
        .setDescription("종류가 '숫자'일 때 0~36")
        .setMinValue(0)
        .setMaxValue(36),
    ),

  async execute(interaction) {
    const kind = interaction.options.getString("종류");
    const bet = interaction.options.getInteger("금액");
    const pick = interaction.options.getInteger("숫자");

    if (kind === "number" && pick === null) {
      return interaction.reply({
        content: "❌ 종류가 '숫자'이면 `숫자`(0~36)도 입력해 주세요.",
        flags: MessageFlags.Ephemeral,
      });
    }

    let user;
    try {
      user = getUserOrFail(interaction, bet);
    } catch (err) {
      const content =
        err.message === "NOT_REGISTERED"
          ? "먼저 `/게임 가입`으로 가입해주세요!"
          : `💸 돈이 부족해요! (필요: ${bet.toLocaleString()}원)`;
      return interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }

    const spin = crypto.randomInt(38); // 0~36, 37 = 00
    const isNumber = spin !== 0 && spin !== DOUBLE_ZERO;
    let mult = 0;
    if (kind === "red") mult = isNumber && RED.has(spin) ? 2 : 0;
    else if (kind === "black") mult = isNumber && !RED.has(spin) ? 2 : 0;
    else mult = spin === pick ? 36 : 0;

    const net = bet * mult - bet;
    db.prepare("UPDATE user SET money = money + ? WHERE user_id = ?").run(
      net,
      user.user_id,
    );
    cache.invalidateMoney(user.user_id);
    if (bet >= 50)
      require("../../managers/progress").record(user.user_id, "play");

    const choiceText = {
      red: "🟥 빨강",
      black: "⬛ 검정",
      number: `숫자 ${pick}`,
    }[kind];
    const embed = new EmbedBuilder()
      .setColor(net > 0 ? 0x57f287 : 0xed4245)
      .setTitle(net > 0 ? "🎉 적중!" : "😢 꽝")
      .setDescription(
        `🎡 나온 칸: ${emojiOf(spin)} **${nameOf(spin)}** (${colorOf(spin)})\n` +
          `👤 내 선택: **${choiceText}**\n\n` +
          `💵 손익: **${net >= 0 ? "+" : ""}${net.toLocaleString()}원**\n` +
          `💰 현재 잔액: **${(user.money + net).toLocaleString()}원**`,
      )
      .setFooter({ text: "0과 00은 색 베팅이 모두 꽝" })
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  },
};
