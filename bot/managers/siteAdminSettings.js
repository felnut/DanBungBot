const { PermissionFlagsBits: P, ChannelType } = require("discord.js");
const { formatTime } = require("./lunchSchedule");
class SettingsError extends Error {
  constructor(code, status = 400) { super(code); this.status = status; }
}
const fail = (code, status) => { throw new SettingsError(code, status); };
const snowflake = value => typeof value === "string" && /^\d{15,25}$/.test(value);

function createAdminSettings({ db, client, neisRows, getSchools, maxSchools = 5 }) {
  const registered = (userId, guildId) => Boolean(db.prepare(
    "SELECT 1 FROM admin_contact WHERE user_id = ? AND guild_id = ?",
  ).get(userId, guildId));

  async function access(userId, guildId) {
    if (!registered(userId, guildId)) fail("forbidden", 403);
    if (!client?.isReady()) fail("bot_unavailable", 503);
    let guild, member;
    try {
      guild = await client.guilds.fetch({ guild: guildId, force: true });
      await guild.roles.fetch();
      member = await guild.members.fetch({ user: userId, force: true });
    } catch (error) {
      if ([10004, 10007, 50001].includes(error.code)) fail("forbidden", 403);
      fail("discord_unavailable", 503);
    }
    const canManageSchools = guild.ownerId === userId || member.permissions.has(P.Administrator);
    if (!canManageSchools && !member.permissions.has(P.ManageGuild)) fail("forbidden", 403);
    return { guild, member, canManageSchools };
  }

  async function channelsFor(guild, member) {
    const channels = await guild.channels.fetch();
    const mine = await guild.members.fetchMe({ force: true });
    return [...channels.values()].filter(channel => channel &&
      [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type) &&
      channel.permissionsFor(member)?.has(P.ViewChannel) &&
      channel.permissionsFor(mine)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks]))
      .sort((a, b) => a.position - b.position)
      .map(({ id, name }) => ({ id, name }));
  }

  function guardRegistration(userId, guildId) {
    if (!registered(userId, guildId)) fail("forbidden", 403);
  }

  function writeSchool(guildId, userId, action, school) {
    return db.transaction(() => {
      guardRegistration(userId, guildId);
      const rows = db.prepare("SELECT school_code, is_default FROM guild_schools WHERE guild_id = ? ORDER BY registered_at, school_code").all(guildId);
      const found = rows.find(row => row.school_code === school.code);
      if (action === "add-school") {
        if (found) fail("school_duplicate", 409);
        if (rows.length >= maxSchools) fail("school_limit", 409);
        db.prepare("INSERT INTO guild_schools (guild_id, school_code, atpt_code, school_name, school_kind, registered_by, registered_at, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(guildId, school.code, school.atpt, school.name, school.kind, userId, Date.now(), rows.length ? 0 : 1);
      } else {
        if (!found) fail("school_not_found", 404);
        if (action === "default-school") {
          db.prepare("UPDATE guild_schools SET is_default = 0 WHERE guild_id = ?").run(guildId);
          db.prepare("UPDATE guild_schools SET is_default = 1 WHERE guild_id = ? AND school_code = ?").run(guildId, school.code);
        } else {
          db.prepare("DELETE FROM guild_schools WHERE guild_id = ? AND school_code = ?").run(guildId, school.code);
          const next = rows.find(row => row.school_code !== school.code);
          if (found.is_default && next) db.prepare("UPDATE guild_schools SET is_default = 1 WHERE guild_id = ? AND school_code = ?").run(guildId, next.school_code);
        }
      }
    }).immediate();
  }

  async function run({ userId, guildId, method, query, body }) {
    if (!snowflake(userId) || !snowflake(guildId)) fail("invalid_id");
    const { guild, member, canManageSchools } = await access(userId, guildId);
    if (method === "GET" && query !== undefined) {
      if (typeof query !== "string" || query.trim().length < 2 || query.length > 30) fail("invalid_query");
      const rows = await neisRows(null, "schoolInfo", { SCHUL_NM: query.trim(), pSize: 25 }, 600000);
      guardRegistration(userId, guildId);
      return { schools: rows.filter(row => ["초등학교", "중학교", "고등학교", "특수학교"].includes(row.SCHUL_KND_SC_NM)).slice(0, 25).map(row => ({
        code: row.SD_SCHUL_CODE, atpt: row.ATPT_OFCDC_SC_CODE, name: row.SCHUL_NM,
        kind: row.SCHUL_KND_SC_NM, address: row.ORG_RDNMA || row.ATPT_OFCDC_SC_NM || "",
      })) };
    }
    if (method === "PATCH") {
      if (!body || typeof body !== "object" || Array.isArray(body)) fail("invalid_request");
      const { action } = body;
      const fields = {
        "add-school": ["action", "code", "atpt"], "default-school": ["action", "code"],
        "remove-school": ["action", "code"], "set-lunch": ["action", "channelId", "time"], "disable-lunch": ["action"],
      }[action];
      if (!Array.isArray(fields) || Object.keys(body).some(key => !fields.includes(key))) fail("invalid_action");
      if (["default-school", "remove-school"].includes(action) && !canManageSchools) fail("school_admin_required", 403);
      if (action.endsWith("school")) {
        if (typeof body.code !== "string" || !/^\d{5,12}$/.test(body.code)) fail("invalid_school");
        let school = { code: body.code };
        if (action === "add-school") {
          if (typeof body.atpt !== "string" || !/^[A-Z]\d{2}$/.test(body.atpt)) fail("invalid_school");
          const rows = await neisRows(null, "schoolInfo", { ATPT_OFCDC_SC_CODE: body.atpt, SD_SCHUL_CODE: body.code, pSize: 5 }, 600000);
          const row = rows.find(row => row.SD_SCHUL_CODE === body.code && row.ATPT_OFCDC_SC_CODE === body.atpt && ["초등학교", "중학교", "고등학교", "특수학교"].includes(row.SCHUL_KND_SC_NM));
          if (!row) fail("school_not_found", 404);
          school = { code: row.SD_SCHUL_CODE, atpt: row.ATPT_OFCDC_SC_CODE, name: row.SCHUL_NM, kind: row.SCHUL_KND_SC_NM };
        }
        writeSchool(guildId, userId, action, school);
      } else if (action === "set-lunch") {
        if (!snowflake(body.channelId)) fail("invalid_channel");
        if (typeof body.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) fail("invalid_time");
        const [hour, minute] = body.time.split(":").map(Number);
        const channels = await channelsFor(guild, member);
        if (!channels.some(channel => channel.id === body.channelId)) fail("channel_unavailable", 400);
        guardRegistration(userId, guildId);
        db.prepare("INSERT INTO lunch_notice (guild_id, channel_id, last_sent, send_minutes) VALUES (?, ?, NULL, ?) ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id, send_minutes = excluded.send_minutes").run(guildId, body.channelId, hour * 60 + minute);
      } else {
        guardRegistration(userId, guildId);
        db.prepare("DELETE FROM lunch_notice WHERE guild_id = ?").run(guildId);
      }
      return { saved: true };
    }
    if (method !== "GET") fail("method_not_allowed", 405);
    const channels = await channelsFor(guild, member);
    guardRegistration(userId, guildId);
    const lunch = db.prepare("SELECT channel_id, send_minutes FROM lunch_notice WHERE guild_id = ?").get(guildId);
    return {
      guild: { id: guild.id, name: guild.name, memberCount: guild.memberCount, botConnected: true },
      schools: getSchools(guildId).map(({ code, atpt, name, kind, isDefault }) => ({ code, atpt, name, kind, isDefault })),
      maxSchools, canManageSchools, channels,
      lunch: { channelId: lunch?.channel_id || null, time: formatTime(lunch?.send_minutes), schedule: `평일 ${formatTime(lunch?.send_minutes)} (한국 시간)` },
    };
  }
  return { run };
}

async function readBody(request) {
  if (!(request.headers["content-type"] || "").startsWith("application/json")) fail("json_required", 415);
  if (Number(request.headers["content-length"]) > 4096) fail("body_too_large", 413);
  let size = 0;
  const parts = [];
  for await (const part of request) {
    size += part.length;
    if (size > 4096) fail("body_too_large", 413);
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString("utf8")); }
  catch { fail("invalid_json"); }
}
module.exports = { createAdminSettings, SettingsError, readBody };
