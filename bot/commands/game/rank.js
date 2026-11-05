const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const db = require("../../../Database");
const cache = require("../utils/cache");
const { rankingEmbed } = require("../../managers/rankings");
const { GUILD_RANK_ENABLED } = require("../../config");

const stmtMoney = db.prepare("SELECT money FROM user WHERE user_id = ?");
const stmtRicherGlobal = db.prepare(
  "SELECT COUNT(*) AS cnt FROM user WHERE money > ?",
);
const stmtRicherGuild = db.prepare(
  `SELECT COUNT(*) AS cnt FROM user u JOIN user_guild g ON g.user_id = u.user_id
   WHERE g.guild_id = ? AND u.money > ?`,
);
const stmtInGuild = db.prepare(
  "SELECT 1 FROM user_guild WHERE guild_id = ? AND user_id = ?",
);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("랭킹")
    .setDescription("돈 순위 (전체 + 이 서버 TOP 5)"),

  async execute(interaction) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    const embed = await rankingEmbed("money", guildId);

    // ====================== 내 순위 ======================
    const me = stmtMoney.get(userId);
    if (!me) {
      embed.addFields({
        name: "📍 내 순위",
        value: "아직 가입 안 했어요!\n`/게임 가입`을 먼저 입력하세요!",
      });
    } else {
      const lines = [
        `🌐 전체 **${(stmtRicherGlobal.get(me.money).cnt + 1).toLocaleString()}위** · ${me.money.toLocaleString()}원`,
      ];
      if (GUILD_RANK_ENABLED && guildId) {
        lines.push(
          stmtInGuild.get(guildId, userId)
            ? `🏠 이 서버 **${(stmtRicherGuild.get(guildId, me.money).cnt + 1).toLocaleString()}위**`
            : "🏠 이 서버에서 아직 명령어를 쓰지 않아 순위에 없어요",
        );
      }
      embed.addFields({ name: "📍 내 순위", value: lines.join("\n") });
    }
    return interaction.reply({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  },
};
