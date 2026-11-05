const { SlashCommandBuilder } = require("discord.js");
const crypto = require("node:crypto");
const {
  MIN_BET,
  TOTAL,
  pickWeighted,
  play,
} = require("../../managers/instantGame");

// 777 0.8%×20 + 세 개 4%×5 + 두 개 14%×2 + 체리 한 개 30%×1 = 0.94 → 환수율 94%
const OUTCOMES = [
  { key: "jackpot", weight: 0.008 * TOTAL, mult: 20 },
  { key: "triple", weight: 0.04 * TOTAL, mult: 5 },
  { key: "pair", weight: 0.14 * TOTAL, mult: 2 },
  { key: "cherry", weight: 0.3 * TOTAL, mult: 1 },
  { key: "none", weight: 0.512 * TOTAL, mult: 0 },
];
const SYMBOLS = ["🍋", "🔔", "⭐", "🍇"]; // 체리(🍒)와 7️⃣은 따로 쓴다

const sample = (arr, n) => {
  const pool = [...arr];
  const out = [];
  while (out.length < n)
    out.push(pool.splice(crypto.randomInt(pool.length), 1)[0]);
  return out;
};
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

/** 결과에 맞는 릴 3칸을 만든다 */
function reelsFor(key) {
  if (key === "jackpot") return ["7️⃣", "7️⃣", "7️⃣"];
  if (key === "triple") {
    const s = sample(SYMBOLS, 1)[0];
    return [s, s, s];
  }
  if (key === "pair") {
    const [a, b] = sample(SYMBOLS, 2);
    return shuffle([a, a, b]);
  }
  if (key === "cherry") return shuffle(["🍒", ...sample(SYMBOLS, 2)]);
  return sample(SYMBOLS, 3);
}

const TITLES = {
  jackpot: "💎 잭팟! 777",
  triple: "🎉 세 개 일치!",
  pair: "✨ 두 개 일치!",
  cherry: "🍒 체리로 본전!",
  none: "😢 꽝...",
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("슬롯")
    .setDescription(
      "슬롯머신! 777은 20배, 세 개 일치 5배, 두 개 일치 2배, 체리는 본전",
    )
    .addIntegerOption((o) =>
      o
        .setName("금액")
        .setDescription("베팅할 금액")
        .setRequired(true)
        .setMinValue(MIN_BET),
    ),

  async execute(interaction) {
    const bet = interaction.options.getInteger("금액");
    return play(
      interaction,
      bet,
      () => pickWeighted(OUTCOMES),
      (o) => ({
        title: TITLES[o.key],
        description: `┃ ${reelsFor(o.key).join(" ┃ ")} ┃`,
      }),
    );
  },
};
