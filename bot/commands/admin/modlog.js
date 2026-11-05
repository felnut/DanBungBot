const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require("discord.js");
const mod = require("../../managers/moderation");

const EPHEMERAL = MessageFlags.Ephemeral;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("로그채널설정")
    .setDescription("[서버 운영자 전용] 제재·경고 기록을 남길 채널 설정")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // 서버 관리 권한(관리자 포함)이 있는 사람에게만 보임
    .setDMPermission(false)
    .addChannelOption((o) =>
      o
        .setName("채널")
        .setDescription("비워 두면 설정을 해제해요")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    ),

  async execute(interaction) {
    const denied = mod.checkActor(interaction);
    if (denied) return interaction.reply({ content: denied, flags: EPHEMERAL });

    const ch = interaction.options.getChannel("채널");
    if (!ch) {
      const n = mod.stmtLogClear.run(interaction.guildId).changes;
      return interaction.reply({
        content: n
          ? "🔕 로그 채널을 해제했어요."
          : "설정된 로그 채널이 없어요.",
        flags: EPHEMERAL,
      });
    }
    const mine = ch.permissionsFor(interaction.guild.members.me);
    if (
      !mine?.has(PermissionFlagsBits.ViewChannel) ||
      !mine.has(PermissionFlagsBits.SendMessages) ||
      !mine.has(PermissionFlagsBits.EmbedLinks)
    ) {
      return interaction.reply({
        content: `❌ 봇에게 <#${ch.id}>의 **채널 보기, 메시지 보내기, 링크 첨부** 권한이 필요해요.`,
        flags: EPHEMERAL,
      });
    }
    mod.stmtLogSet.run(interaction.guildId, ch.id);
    return interaction.reply({
      content: `✅ 제재·경고 기록을 <#${ch.id}>에 남길게요. (이 봇으로 처리한 것만 기록돼요)`,
      flags: EPHEMERAL,
    });
  },
};
