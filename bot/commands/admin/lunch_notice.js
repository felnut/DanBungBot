const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database");
const { isServerManager } = require("../utils/perm");

const EPHEMERAL = MessageFlags.Ephemeral;

const stmtSet = db.prepare(
  "INSERT INTO lunch_notice (guild_id, channel_id, last_sent) VALUES (?, ?, NULL) ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id",
);
const stmtGet = db.prepare(
  "SELECT channel_id FROM lunch_notice WHERE guild_id = ?",
);
const stmtDel = db.prepare("DELETE FROM lunch_notice WHERE guild_id = ?");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("급식알림")
    .setDescription(
      "평일 아침 7시 30분에 오늘 급식을 자동으로 올려요 (설정·해제는 서버 운영자 전용)",
    )
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("설정")
        .setDescription("알림을 받을 채널 지정")
        .addChannelOption((o) =>
          o
            .setName("채널")
            .setDescription("급식을 올릴 채널")
            .setRequired(true)
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
            ),
        ),
    )
    .addSubcommand((s) => s.setName("해제").setDescription("급식 알림 끄기"))
    .addSubcommand((s) => s.setName("확인").setDescription("현재 설정 보기")),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    // 확인은 누구나, 설정·해제는 서버 운영자급만
    if (
      !interaction.inGuild() ||
      (sub !== "확인" && !isServerManager(interaction))
    ) {
      return interaction.reply({
        content:
          "❌ 서버 소유자 또는 서버 관리 권한이 있는 역할만 사용할 수 있어요.",
        flags: EPHEMERAL,
      });
    }

    if (sub === "설정") {
      const ch = interaction.options.getChannel("채널");
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
      stmtSet.run(interaction.guildId, ch.id);
      return interaction.reply({
        content: `✅ 평일 07:30에 <#${ch.id}>에 오늘 급식을 올릴게요. (급식이 없는 날은 올리지 않아요)`,
        flags: EPHEMERAL,
      });
    }
    if (sub === "해제") {
      const n = stmtDel.run(interaction.guildId).changes;
      return interaction.reply({
        content: n ? "🔕 급식 알림을 껐어요." : "설정된 급식 알림이 없어요.",
        flags: EPHEMERAL,
      });
    }
    const row = stmtGet.get(interaction.guildId);
    return interaction.reply({
      content: row
        ? `🔔 급식 알림: <#${row.channel_id}> (평일 07:30)`
        : "설정된 급식 알림이 없어요.",
      flags: EPHEMERAL,
    });
  },
};
