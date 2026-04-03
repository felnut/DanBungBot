const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database");
const { getUserOrFail } = require("../utils/user");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("송금")
    .setDescription("다른 유저에게 돈을 보냅니다 📤")
    .addUserOption((option) =>
      option.setName("유저").setDescription("돈을 보낼 유저").setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("금액")
        .setDescription("보낼 금액")
        .setRequired(true)
        .setMinValue(1),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target = interaction.options.getUser("유저");
    const amount = interaction.options.getInteger("금액");

    // 자기 자신에게 송금 금지
    if (target.id === interaction.user.id) {
      return interaction.editReply({
        content: "자기 자신한테는 못 보내요 ㅠㅠ",
        flags: 64,
      });
    }
    // 봇에게 송금 금지
    if (target.bot) {
      return interaction.editReply({
        content: "봇한테는 돈 못 보내요!",
        flags: 64,
      });
    }

    let sender;
    try {
      sender = getUserOrFail(interaction, amount); // 송금자 잔액 체크
    } catch (err) {
      const content =
        err.message === "NOT_REGISTERED"
          ? "먼저 `/돈`으로 가입해주세요!"
          : `💸 돈이 부족해요! (필요: ${amount.toLocaleString()}원)`;
      return interaction.editReply({ content, flags: MessageFlags.Ephemeral });
    }

    // 받는 사람이 가입되어 있는지 확인
    const receiver = db
      .prepare("SELECT * FROM user WHERE user_id = ?")
      .get(target.id);
    if (!receiver) {
      return interaction.editReply({
        content: `${target} 님은 아직 가입 안 했어요.\n상대방이 먼저 \`/돈\` 쳐야 송금 가능해요!`,
        flags: 64,
      });
    }

    // ====================== 실제 송금 처리 ======================
    const senderNewMoney = sender.money - amount;
    const receiverNewMoney = receiver.money + amount;

    if (senderNewMoney < 0) throw new Error("잔액 부족으로 송금 실패");

    db.prepare("UPDATE user SET money = ? WHERE user_id = ?").run(
      senderNewMoney,
      sender.user_id,
    );
    db.prepare("UPDATE user SET money = ? WHERE user_id = ?").run(
      receiverNewMoney,
      target.id,
    );

    const embed = new EmbedBuilder()
      .setColor("#3498db")
      .setTitle("✅ 송금 완료!")
      .setDescription(
        `${target}님께 **${amount.toLocaleString()} 원** 보냈어요 💸`,
      )
      .addFields(
        {
          name: "내 잔고",
          value: `**${senderNewMoney.toLocaleString()} 원**`,
          inline: true,
        },
        {
          name: "받는 사람 잔고",
          value: `**${receiverNewMoney.toLocaleString()} 원**`,
          inline: true,
        },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
