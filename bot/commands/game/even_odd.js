const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database");
const { getUserOrFail } = require("../utils/user");
const cache = require("../utils/cache");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("홀짝")
    .setDescription("이기면 2배, 지면 액수만큼 잃습니다.")
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
    const resultNum = Math.floor(Math.random() * 10) + 1;
    const result = resultNum % 2 === 0 ? "even" : "odd";
    const isWin = choice === result;
    const reward = isWin ? bet : -bet; // 승리 시 베팅액만큼 순이익(원금 포함 2배), 패배 시 -베팅액

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
      .setTitle(isWin ? "🎉 승리! 2배 당첨!" : "😢 패배...")
      .setDescription(
        `🎲나온 숫자\n**${resultNum} (${result === "even" ? "짝" : "홀"})**\n\n` +
          `👤내 선택\n**${choice === "even" ? "짝" : "홀"}**\n\n` +
          `💵수익\n**${isWin ? `+${bet.toLocaleString()}` : `-${bet.toLocaleString()}`}원**\n\n` +
          `💰현재 잔액\n**${newBalance.toLocaleString()}원**`,
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
