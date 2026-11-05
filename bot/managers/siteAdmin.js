const { PermissionFlagsBits } = require("discord.js");
async function registeredGuilds(client, rows, userId) {
  if (!client?.isReady()) throw new Error("bot_unavailable");
  const allowed = [];
  for (const row of rows) {
    let guild, member;
    try {
      guild = await client.guilds.fetch({ guild: row.guild_id, force: true });
      await guild.roles.fetch();
      member = await guild.members.fetch({ user: userId, force: true });
    } catch (error) {
      if ([10004, 10007, 50001].includes(error.code)) continue;
      throw error;
    }
    if (guild.ownerId === userId || member.permissions.has(PermissionFlagsBits.ManageGuild))
      allowed.push({ id: guild.id, name: guild.name });
  }
  return allowed;
}
module.exports = { registeredGuilds };
