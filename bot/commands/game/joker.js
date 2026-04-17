const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database.js");
const { getUserOrFail } = require("../utils/user.js");
const cache = require("../utils/cache");

const stmtSelectBank = db.prepare(
  "SELECT amount, failed_attempts FROM bank WHERE id = 1",
);
const stmtResetBank = db.prepare(
  "UPDATE bank SET amount = 0, failed_attempts = 0 WHERE id = 1",
);
const stmtAddBankFail = db.prepare(
  "UPDATE bank SET amount = amount + ?, failed_attempts = failed_attempts + 1 WHERE id = 1",
);
const stmtUpdateUserMoneyDelta = db.prepare(
  "UPDATE user SET money = money + ? WHERE user_id = ?",
);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("조커")
    .setDescription("조커 찾기 게임! 베팅 5만원으로 한 번 뽑아보자!"),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const betAmount = 50000; // 고정 베팅 금액

    let user;
    try {
      user = getUserOrFail(interaction, betAmount); // 가입 + 잔액 체크
    } catch (error) {
      // 에러 처리 (가입 안 함 / 돈 부족)
      let content = "에러가 발생했어! 나중에 다시 시도해 봐.";
      if (error.message === "NOT_REGISTERED") {
        content = '먼저 "/돈" 명령어로 가입하세요!';
      } else if (error.message === "INSUFFICIENT_MONEY") {
        const u = db
          .prepare("SELECT money FROM user WHERE user_id = ?")
          .get(interaction.user.id);
        content = `돈이 부족해! 필요 금액: ${betAmount.toLocaleString()}원\n보유: ${u?.money?.toLocaleString() || 0}원`;
      }
      return interaction.editReply({ content, flags: MessageFlags.Ephemeral });
    }

    // ==================== 카드 뽑기 ====================
    // 52장 + 조커 덱 생성 후 셔플
    const suits = ["♥", "♦", "♣", "♠"];
    const ranks = [
      "A",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "J",
      "Q",
      "K",
    ];
    let deck = [];
    for (const suit of suits) {
      for (const rank of ranks) deck.push(`${rank}${suit}`);
    }
    deck.push("Joker");

    // 피셔-예이츠 셔플
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    const card = deck.pop(); // 최종 뽑은 카드

    const embed = new EmbedBuilder()
      .setTitle("🃏 조커 찾기 결과")
      .setDescription(`뽑은 카드: **${card}**`)
      .setTimestamp()
      .setFooter({ text: "저금은 계속 쌓여요! 다음에 도전해보세요!" });

    // ==================== 당첨 / 꽝 처리 ====================
    const tx = db.transaction(() => {
      // 베팅 차감 (항상 실행)
      stmtUpdateUserMoneyDelta.run(-betAmount, interaction.user.id);

      const bank = stmtSelectBank.get() || { amount: 0, failed_attempts: 0 };

      if (card === "Joker") {
        const prize = betAmount * 10 + (bank.amount || 0);
        stmtUpdateUserMoneyDelta.run(prize, interaction.user.id);
        stmtResetBank.run();

        return {
          outcome: "win",
          prize,
          finalBank: { amount: 0, failed_attempts: 0 },
          finalMoney: user.money - betAmount + prize,
        };
      }

      const saveAmount = Math.floor(betAmount * 0.1);
      stmtAddBankFail.run(saveAmount);

      const finalBank = stmtSelectBank.get() || {
        amount: 0,
        failed_attempts: 0,
      };

      return {
        outcome: "lose",
        saveAmount,
        finalBank,
        finalMoney: user.money - betAmount,
      };
    });

    const result = tx();

    cache.del(`leaderboard:money:myRank:${interaction.user.id}`);
    cache.del("leaderboard:money:top10");

    embed.addFields(
      {
        name: "현재 저금",
        value: `${result.finalBank.amount.toLocaleString()}원`,
        inline: true,
      },
      {
        name: "실패 횟수",
        value: `${result.finalBank.failed_attempts}회`,
        inline: true,
      },
    );

    if (result.outcome === "win") {
      embed.setColor("#00FF7F").addFields({
        name: "🎉 대박!! 조커 당첨!",
        value: `상금 **${result.prize.toLocaleString()}원** 지급!\n저금 초기화됐어요!`,
      });
    } else {
      embed.setColor("#FF4500").addFields({
        name: "😢 아... 꽝",
        value: `${result.saveAmount.toLocaleString()}원이 저금통에 들어갔어요`,
      });
    }

    embed.addFields({
      name: "💰 현재 잔액",
      value: `${result.finalMoney.toLocaleString()}원`,
      inline: false,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};
