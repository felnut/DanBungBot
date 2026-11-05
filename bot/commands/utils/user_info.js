const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("유저정보")
    .setDescription("내 정보 또는 다른 유저의 정보를 보여줘요!")
    .setDMPermission(false)
    .addUserOption((o) =>
      o.setName("유저").setDescription("비워 두면 내 정보"),
    ),

  async execute(interaction) {
    const user = interaction.options.getUser("유저") ?? interaction.user;
    const member =
      interaction.options.getMember("유저") ??
      (user.id === interaction.user.id ? interaction.member : null);
    const ts = (ms) => `<t:${Math.floor(ms / 1000)}:D>`;

    const embed = new EmbedBuilder()
      .setColor(
        member?.displayHexColor && member.displayHexColor !== "#000000"
          ? member.displayHexColor
          : "#5865f2",
      )
      .setTitle(`👤 ${member?.displayName ?? user.username}`)
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: "사용자명", value: user.username, inline: true },
        { name: "ID", value: user.id, inline: true },
        { name: "종류", value: user.bot ? "🤖 봇" : "사람", inline: true },
        { name: "계정 생성일", value: ts(user.createdTimestamp), inline: true },
      )
      .setTimestamp();
    if (member?.joinedTimestamp) {
      embed.addFields(
        {
          name: "서버 참여일",
          value: ts(member.joinedTimestamp),
          inline: true,
        },
        {
          name: "역할",
          value: `${Math.max(member.roles.cache.size - 1, 0)}개`,
          inline: true,
        },
      );
    }
    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  },
};
