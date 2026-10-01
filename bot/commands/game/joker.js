const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database.js");
const { getUserOrFail } = require("../utils/user.js");
const cache = require("../utils/cache");

// 카드 한 장을 뽑아 숫자에 따라 배당 (53장: 조커 1 + 4무늬 × 13랭크, 각 장 확률 1/53)
// 배당(베팅 대비 지급 배수): 합계 52.5 / 53 → 환수율 약 99.1%, 하우스 엣지 약 0.9%
// 이익(>1배) 약 32%, 본전(1배) 7.5%, 일부 손실(0.5배) 7.5%, 전액 손실 53%
const BET_AMOUNT = 50000; // 고정 베팅 금액
const SUITS = ["♥", "♦", "♣", "♠"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const PAYOUT_BY_RANK = {
  A: 3,
  K: 2,
  Q: 2,
  J: 2,
  10: 1,
  9: 0.5,
};
const JOKER_PAYOUT = 10.5;

const DECK = [
  ...SUITS.flatMap((suit) => RANKS.map((rank) => ({ label: `${rank}${suit}`, rank }))),
  { label: "Joker", rank: "Joker" },
];

function payoutOf(card) {
  if (card.rank === "Joker") return JOKER_PAYOUT;
  return PAYOUT_BY_RANK[card.rank] ?? 0;
}

const stmtUpdateUserMoneyDelta = db.prepare(
  "UPDATE user SET money = money + ? WHERE user_id = ?",
);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("조커")
    .setDescription(
      "조커 찾기 게임! 베팅 5만원, 카드 한 장으로 최대 10.5배!",
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let user;
    try {
      user = getUserOrFail(interaction, BET_AMOUNT); // 가입 + 잔액 체크
    } catch (error) {
      let content = "에러가 발생했어! 나중에 다시 시도해 봐.";
      if (error.message === "NOT_REGISTERED") {
        content = '먼저 "/돈" 명령어로 가입하세요!';
      } else if (error.message === "INSUFFICIENT_MONEY") {
        const u = db
          .prepare("SELECT money FROM user WHERE user_id = ?")
          .get(interaction.user.id);
        content = `돈이 부족해! 필요 금액: ${BET_AMOUNT.toLocaleString()}원\n보유: ${u?.money?.toLocaleString() || 0}원`;
      }
      return interaction.editReply({ content, flags: MessageFlags.Ephemeral });
    }

    const card = DECK[Math.floor(Math.random() * DECK.length)];
    const multiplier = payoutOf(card);
    const prize = Math.floor(BET_AMOUNT * multiplier); // 지급액(베팅 포함)
    const net = prize - BET_AMOUNT;

    stmtUpdateUserMoneyDelta.run(net, interaction.user.id);
    cache.del(`leaderboard:money:myRank:${interaction.user.id}`);
    cache.del("leaderboard:money:top10");

    let title;
    let color;
    if (net > 0) {
      title = card.rank === "Joker" ? "🎉 대박!! 조커 당첨!" : "😊 당첨!";
      color = "#00FF7F";
    } else if (net === 0) {
      title = "😐 본전!";
      color = "#FFD700";
    } else if (prize > 0) {
      title = "😅 반쪽 당첨";
      color = "#FFA500";
    } else {
      title = "😢 아... 꽝";
      color = "#FF4500";
    }

    const embed = new EmbedBuilder()
      .setTitle("🃏 조커 찾기 결과")
      .setDescription(`뽑은 카드: **${card.label}**`)
      .setColor(color)
      .addFields(
        { name: title, value: `배당 **${multiplier}배** → ${prize.toLocaleString()}원 지급`, inline: false },
        {
          name: "손익",
          value: `${net >= 0 ? "+" : ""}${net.toLocaleString()}원`,
          inline: true,
        },
        {
          name: "💰 현재 잔액",
          value: `${(user.money + net).toLocaleString()}원`,
          inline: true,
        },
      )
      .setFooter({
        text: "조커 10.5배 · A 3배 · J/Q/K 2배 · 10 본전 · 9 반액 · 나머지 꽝",
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
