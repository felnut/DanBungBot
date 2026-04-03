const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database.js");
const { getUserOrFail } = require("../utils/user.js");

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

    // 돈 차감
    db.prepare("UPDATE user SET money = money - ? WHERE user_id = ?").run(
      betAmount,
      interaction.user.id,
    );
    user.money -= betAmount;

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

    // 은행(저금통) 정보 불러오기
    const row = db
      .prepare("SELECT amount, failed_attempts FROM bank LIMIT 1")
      .get();

    let bank = row || { amount: 0, failed_attempts: 0 };

    const embed = new EmbedBuilder()
      .setTitle("🃏 조커 찾기 결과")
      .setDescription(`뽑은 카드: **${card}**`)
      .addFields(
        {
          name: "현재 저금",
          value: `${bank.amount.toLocaleString()}원`,
          inline: true,
        },
        { name: "실패 횟수", value: `${bank.failed_attempts}회`, inline: true },
      )
      .setTimestamp()
      .setFooter({ text: "저금은 계속 쌓여요! 다음에 도전해보세요!" });

    // ==================== 당첨 / 꽝 처리 ====================
    if (card === "Joker") {
      let prize = betAmount * 10;

      // 당첨 시에도 최신 bank 값으로 계산
      const currentBank = db.prepare("SELECT amount FROM bank").get() || {
        amount: 0,
      };
      if (currentBank.amount > 0) prize += currentBank.amount;

      const newMoney = user.money + prize;
      db.prepare("UPDATE user SET money = ? WHERE user_id = ?").run(
        newMoney,
        interaction.user.id,
      );
      db.prepare("UPDATE bank SET amount = 0, failed_attempts = 0").run();

      embed.setColor("#00FF7F").addFields({
        name: "🎉 대박!! 조커 당첨!",
        value: `상금 **${prize.toLocaleString()}원** 지급!\n저금 초기화됐어요!`,
      });

      // bank 변수도 초기화
      bank.amount = 0;
      bank.failed_attempts = 0;
    } else {
      const saveAmount = Math.floor(betAmount * 0.1);

      db.prepare(
        "UPDATE bank SET amount = amount + ?, failed_attempts = failed_attempts + 1",
      ).run(saveAmount);

      embed.setColor("#FF4500").addFields({
        name: "😢 아... 꽝",
        value: `${saveAmount.toLocaleString()}원이 저금통에 들어갔어요`,
      });

      // 업데이트 후 bank 변수 갱신
      const updatedBank = db
        .prepare("SELECT amount, failed_attempts FROM bank")
        .get() || {
        amount: 0,
        failed_attempts: 0,
      };

      bank.amount = updatedBank.amount;
      bank.failed_attempts = updatedBank.failed_attempts;
    }

    // embed에 보이는 저금/실패 횟수를 DB 최신값으로 교체
    const finalBank = db
      .prepare("SELECT amount, failed_attempts FROM bank LIMIT 1")
      .get() || {
      amount: 0,
      failed_attempts: 0,
    };

    embed.spliceFields(
      0,
      2, // 첫 번째 필드 2개(현재 저금 + 실패 횟수)를 교체
      {
        name: "현재 저금",
        value: `${finalBank.amount.toLocaleString()}원`,
        inline: true,
      },
      {
        name: "실패 횟수",
        value: `${finalBank.failed_attempts}회`,
        inline: true,
      },
    );

    // 최종 잔액 표시
    const finalMoney = card === "Joker" ? newMoney : user.money;
    embed.addFields({
      name: "💰 현재 잔액",
      value: `${finalMoney.toLocaleString()}원`,
      inline: false,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};
