const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const mod = require("../../managers/moderation");

const EPHEMERAL = MessageFlags.Ephemeral;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("차단")
    .setDescription(
      "[서버 운영자 전용] 유저를 서버에서 차단·해제하고 목록 보기",
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // 서버 관리 권한(관리자 포함)이 있는 사람에게만 보임
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("추가")
        .setDescription("유저 차단 (서버에 없어도 가능)")
        .addUserOption((o) =>
          o.setName("유저").setDescription("대상").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("사유").setDescription("사유").setMaxLength(200),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("해제")
        .setDescription("차단 풀기")
        .addUserOption((o) =>
          o.setName("유저").setDescription("대상").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName("목록").setDescription("차단된 유저 보기 (최대 25명)"),
    ),

  async execute(interaction) {
    const denied = mod.checkActor(interaction);
    if (denied) return interaction.reply({ content: denied, flags: EPHEMERAL });
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === "목록") {
        const bans = await interaction.guild.bans.fetch({ limit: 25 });
        if (!bans.size)
          return interaction.reply({
            content: "차단된 유저가 없어요.",
            flags: EPHEMERAL,
          });
        const lines = bans.map(
          (b) =>
            `• ${b.user.username} (${b.user.id})${b.reason ? ` — ${b.reason.slice(0, 60)}` : ""}`,
        );
        return interaction.reply({
          content: `🚫 차단 목록\n${lines.join("\n")}`.slice(0, 1900),
          flags: EPHEMERAL,
          allowedMentions: { parse: [] },
        });
      }

      const user = interaction.options.getUser("유저");
      if (sub === "해제") {
        await interaction.guild.bans.remove(
          user.id,
          `차단 해제 (by ${interaction.user.username})`,
        );
        await mod.sendModLog(interaction.guild, {
          action: "차단 해제",
          targetId: user.id,
          moderatorId: interaction.user.id,
          reason: "해제",
        });
        return interaction.reply({
          content: `✅ <@${user.id}> 님의 차단을 풀었어요.`,
          allowedMentions: { parse: [] },
        });
      }

      const member = interaction.options.getMember("유저");
      const bad = mod.checkTarget(interaction, member, user);
      if (bad) return interaction.reply({ content: bad, flags: EPHEMERAL });
      if (member && !member.bannable) {
        return interaction.reply({
          content:
            "❌ 봇이 이 유저를 차단할 수 없어요. (봇 역할이 더 높고 **멤버 차단** 권한이 필요해요)",
          flags: EPHEMERAL,
        });
      }
      const reason = mod.reasonOf(interaction.options.getString("사유"));
      await interaction.guild.members.ban(user.id, {
        reason: `${reason} (by ${interaction.user.username})`,
      });
      await mod.sendModLog(interaction.guild, {
        action: "차단",
        targetId: user.id,
        moderatorId: interaction.user.id,
        reason,
      });
      return interaction.reply({
        content: `🚫 <@${user.id}> 님을 차단했어요.`,
        allowedMentions: { parse: [] },
      });
    } catch (e) {
      console.error("차단 오류:", e.message);
      return interaction.reply({
        content: "❌ 처리하지 못했어요. 봇 권한과 대상을 확인해 주세요.",
        flags: EPHEMERAL,
      });
    }
  },
};
