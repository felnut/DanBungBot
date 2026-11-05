const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const mod = require("../../managers/moderation");

const EPHEMERAL = MessageFlags.Ephemeral;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("추방")
    .setDescription(
      "[서버 운영자 전용] 유저를 서버에서 추방 (다시 초대받으면 들어올 수 있어요)",
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // 서버 관리 권한(관리자 포함)이 있는 사람에게만 보임
    .setDMPermission(false)
    .addUserOption((o) =>
      o.setName("유저").setDescription("대상").setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("사유").setDescription("사유").setMaxLength(200),
    ),

  async execute(interaction) {
    const denied = mod.checkActor(interaction);
    if (denied) return interaction.reply({ content: denied, flags: EPHEMERAL });

    const user = interaction.options.getUser("유저");
    const member = interaction.options.getMember("유저");
    if (!member)
      return interaction.reply({
        content: "❌ 서버에 없는 유저예요.",
        flags: EPHEMERAL,
      });
    const bad = mod.checkTarget(interaction, member, user);
    if (bad) return interaction.reply({ content: bad, flags: EPHEMERAL });
    if (!member.kickable) {
      return interaction.reply({
        content:
          "❌ 봇이 이 유저를 추방할 수 없어요. (봇 역할이 더 높고 **멤버 추방** 권한이 필요해요)",
        flags: EPHEMERAL,
      });
    }

    const reason = mod.reasonOf(interaction.options.getString("사유"));
    try {
      await member.kick(`${reason} (by ${interaction.user.username})`);
      await mod.sendModLog(interaction.guild, {
        action: "추방",
        targetId: user.id,
        moderatorId: interaction.user.id,
        reason,
      });
      return interaction.reply({
        content: `👢 <@${user.id}> 님을 추방했어요.`,
        allowedMentions: { parse: [] },
      });
    } catch (e) {
      console.error("추방 오류:", e.message);
      return interaction.reply({
        content: "❌ 처리하지 못했어요. 봇 권한을 확인해 주세요.",
        flags: EPHEMERAL,
      });
    }
  },
};
