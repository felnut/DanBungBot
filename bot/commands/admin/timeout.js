const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const mod = require("../../managers/moderation");

const EPHEMERAL = MessageFlags.Ephemeral;
const MAX_MIN = 28 * 24 * 60; // 디스코드 타임아웃 최대 28일

module.exports = {
  data: new SlashCommandBuilder()
    .setName("타임아웃")
    .setDescription(
      "[서버 운영자 전용] 유저를 일정 시간 동안 채팅·음성 참여 제한",
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // 서버 관리 권한(관리자 포함)이 있는 사람에게만 보임
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("설정")
        .setDescription("타임아웃 걸기")
        .addUserOption((o) =>
          o.setName("유저").setDescription("대상").setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("분")
            .setDescription("기간(분), 최대 40320(28일)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(MAX_MIN),
        )
        .addStringOption((o) =>
          o.setName("사유").setDescription("사유").setMaxLength(200),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("해제")
        .setDescription("타임아웃 풀기")
        .addUserOption((o) =>
          o.setName("유저").setDescription("대상").setRequired(true),
        ),
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
    if (!member.moderatable) {
      return interaction.reply({
        content:
          "❌ 봇이 이 유저를 제한할 수 없어요. (봇 역할이 더 높고 **멤버 타임아웃** 권한이 필요해요)",
        flags: EPHEMERAL,
      });
    }

    const sub = interaction.options.getSubcommand();
    const reason = mod.reasonOf(interaction.options.getString("사유"));
    try {
      if (sub === "설정") {
        const minutes = interaction.options.getInteger("분");
        await member.timeout(
          minutes * 60 * 1000,
          `${reason} (by ${interaction.user.username})`,
        );
        await mod.sendModLog(interaction.guild, {
          action: "타임아웃",
          targetId: user.id,
          moderatorId: interaction.user.id,
          reason,
          extra: `${minutes}분`,
        });
        return interaction.reply({
          content: `🔇 <@${user.id}> 님을 ${minutes}분 동안 타임아웃했어요.`,
          allowedMentions: { parse: [] },
        });
      }
      await member.timeout(
        null,
        `타임아웃 해제 (by ${interaction.user.username})`,
      );
      await mod.sendModLog(interaction.guild, {
        action: "타임아웃 해제",
        targetId: user.id,
        moderatorId: interaction.user.id,
        reason: "해제",
      });
      return interaction.reply({
        content: `🔊 <@${user.id}> 님의 타임아웃을 풀었어요.`,
        allowedMentions: { parse: [] },
      });
    } catch (e) {
      console.error("타임아웃 오류:", e.message);
      return interaction.reply({
        content: "❌ 처리하지 못했어요. 봇 권한을 확인해 주세요.",
        flags: EPHEMERAL,
      });
    }
  },
};
