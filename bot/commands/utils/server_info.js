const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ChannelType,
} = require("discord.js");

const TEXT_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
];
const VOICE_TYPES = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("서버정보")
    .setDescription("이 서버의 정보를 보여줘요!")
    .setDMPermission(false),

  async execute(interaction) {
    const g = interaction.guild;
    if (!g)
      return interaction.reply({
        content: "❌ 서버 안에서만 사용할 수 있어요.",
        flags: MessageFlags.Ephemeral,
      });
    const ts = (ms) => `<t:${Math.floor(ms / 1000)}:D>`;
    // 카테고리는 채널 수에서 제외하고, 역할은 모든 서버에 있는 @everyone을 제외한다
    const textCount = g.channels.cache.filter((c) =>
      TEXT_TYPES.includes(c.type),
    ).size;
    const voiceCount = g.channels.cache.filter((c) =>
      VOICE_TYPES.includes(c.type),
    ).size;
    const roleCount = Math.max(g.roles.cache.size - 1, 0);
    const embed = new EmbedBuilder()
      .setColor("#5865f2")
      .setTitle(`🏠 ${g.name}`)
      .setThumbnail(g.iconURL())
      .addFields(
        { name: "서버 ID", value: g.id, inline: true },
        { name: "소유자", value: `<@${g.ownerId}>`, inline: true },
        {
          name: "멤버",
          value: `${g.memberCount.toLocaleString()}명`,
          inline: true,
        },
        {
          name: "채널",
          value: `텍스트 ${textCount}개 · 음성 ${voiceCount}개`,
          inline: true,
        },
        { name: "역할", value: `${roleCount}개`, inline: true },
        {
          name: "부스트",
          value: `레벨 ${g.premiumTier} (${g.premiumSubscriptionCount ?? 0}명)`,
          inline: true,
        },
        { name: "생성일", value: ts(g.createdTimestamp), inline: true },
      )
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  },
};
