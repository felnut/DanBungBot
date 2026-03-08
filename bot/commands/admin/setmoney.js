const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  Message,
} = require("discord.js");
const db = require("../../../Database.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("돈설정")
    .setDescription("[관리자 전용] 특정 유저의 돈을 강제로 설정합니다")
    .addUserOption((option) =>
      option.setName("유저").setDescription("대상 유저").setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("금액")
        .setDescription("설정할 금액 (음수도 가능)")
        .setRequired(true),
    ),

  async execute(interaction) {
    const ownerId = process.env.OWNER_ID;

    // 봇 주인만 사용할 수 있게 제한
    if (interaction.user.id !== ownerId) {
      return interaction.reply({
        content: "이 명령어는 봇 주인만 사용할 수 있어요!",
        flags: MessageFlags.Ephemeral,
      });
    }

    const targetUser = interaction.options.getUser("유저");
    const amount = interaction.options.getInteger("금액");

    if (!targetUser) {
      return interaction.reply({
        content: "유저를 제대로 선택해주세요!",
        flags: MessageFlags.Ephemeral,
      });
    }

    // 유저가 DB에 없으면 생성 (getUserOrFail 대신 직접 처리)
    let user = db
      .prepare("SELECT * FROM user WHERE user_id = ?")
      .get(targetUser.id);
    if (!user) {
      db.prepare("INSERT INTO user (user_id, money) VALUES (?, ?)").run(
        targetUser.id,
        1000,
      );
      user = { user_id: targetUser.id, money: 1000 };
    }

    // 돈 설정
    db.prepare("UPDATE user SET money = ? WHERE user_id = ?").run(
      amount,
      targetUser.id,
    );

    await interaction.reply({
      content: `${targetUser}님의 돈을 **${amount.toLocaleString()}원**으로 설정했어요!`,
      flags: MessageFlags.Ephemeral,
    });

    // 로그로 남기기 (선택)
    console.log(
      `[돈설정] ${interaction.user.tag} → ${targetUser.tag} : ${amount}원`,
    );
  },
};
