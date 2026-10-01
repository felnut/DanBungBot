const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database");
const { getUserOrFail } = require("../utils/user");
const cache = require("../utils/cache");

const WIN_CHANCE = 0.495; // 승률 49.5 : 50.5 → 하우스 엣지 1%

module.exports = {
  data: new SlashCommandBuilder()
    .setName("홀짝")
    .setDescription("이기면 베팅액만큼 받고, 지면 베팅액을 잃습니다. (승률 49.5%)")
    .addStringOption((option) =>
      option
        .setName("선택")
        .setDescription("홀이나 짝을 선택하세요.")
        .setRequired(true)
        .addChoices(
          { name: "홀", value: "odd" },
          { name: "짝", value: "even" },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName("금액")
        .setDescription("베팅할 금액")
        .setRequired(true)
        .setMinValue(1),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const choice = interaction.options.getString("선택"); // 사용자가 선택한 홀/짝
    const bet = interaction.options.getInteger("금액"); // 베팅 금액

    let user;
    try {
      user = getUserOrFail(interaction, bet); // 가입 여부 + 잔액 체크
    } catch (err) {
      let content =
        err.message === "NOT_REGISTERED"
          ? "먼저 `/돈`으로 가입해주세요!"
          : `💸 돈이 부족해요! (필요: ${bet.toLocaleString()}원)`;
      return interaction.editReply({ content, flags: MessageFlags.Ephemeral });
    }

    // 결과 생성 및 승패 판단
    // 승패를 먼저 49.5 : 50.5로 결정하고, 결과 숫자는 그에 맞는 홀/짝에서 뽑는다.
    const isWin = Math.random() < WIN_CHANCE;
    const result = isWin ? choice : choice === "even" ? "odd" : "even";
    const candidates = result === "even" ? [2, 4, 6, 8, 10] : [1, 3, 5, 7, 9];
    const resultNum = candidates[Math.floor(Math.random() * candidates.length)];
    // 1:1 배당, 승률 49.5% → 기대값 = -0.01 × 베팅액 (큰 수의 법칙으로 장기적으로 1% 손실)
    const reward = isWin ? bet : -bet;

    // 돈 업데이트
    const newMoney = user.money + reward;
    if (newMoney < 0) throw new Error("잔액 부족으로 거래 실패");
    db.prepare("UPDATE user SET money = money + ? WHERE user_id = ?").run(
      reward,
      user.user_id,
    );

    cache.del(`leaderboard:money:myRank:${user.user_id}`);
    cache.del("leaderboard:money:top10");

    // 최종 잔액 표시
    const newBalance = newMoney;

    // 결과 임베드
    const embed = new EmbedBuilder()
      .setColor(isWin ? 0x57f287 : 0xed4245)
      .setTitle(isWin ? "🎉 승리!" : "😢 패배...")
      .setDescription(
        `🎲나온 숫자\n**${resultNum} (${result === "even" ? "짝" : "홀"})**\n\n` +
          `👤내 선택\n**${choice === "even" ? "짝" : "홀"}**\n\n` +
          `💵수익\n**${isWin ? `+${reward.toLocaleString()}` : `-${bet.toLocaleString()}`}원**\n\n` +
          `💰현재 잔액\n**${newBalance.toLocaleString()}원**`,
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
