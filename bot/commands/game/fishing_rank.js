const { SlashCommandBuilder } = require("discord.js");
const { rankingEmbed } = require("../../managers/rankings");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("낚시랭킹")
    .setDescription("낚시 도감 순위 (전체 + 이 서버 TOP 5)"),
  async execute(interaction) {
    return interaction.reply({
      embeds: [await rankingEmbed("fishing", interaction.guildId)],
      allowedMentions: { parse: [] },
    });
  },
};
