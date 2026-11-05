const { Events, PermissionFlagsBits } = require("discord.js");

// 봇이 서버에 들어오면 명령어 없이 자동으로 봇의 서버 별명을 바꾼다 (기본 "OMNI", .env의 BOT_NICKNAME으로 변경).
// 이미 별명이 정해져 있으면(관리자가 직접 바꿨으면) 덮어쓰지 않는다. (이전 기본값 "옴니"는 봇이 지정한 것이므로 새 이름으로 바꾼다) BOT_NICKNAME=off 이면 사용하지 않는다.
const PREVIOUS_DEFAULTS = ["옴니"];
const NICKNAME = (process.env.BOT_NICKNAME ?? "OMNI").trim().slice(0, 32);

async function applyNickname(guild) {
  try {
    const me = guild.members.me ?? (await guild.members.fetchMe());
    if (!me || me.nickname === NICKNAME) return;
    if (me.nickname && !PREVIOUS_DEFAULTS.includes(me.nickname)) return; // 관리자가 정한 별명은 유지
    if (!me.permissions.has(PermissionFlagsBits.ChangeNickname)) {
      console.warn(
        `봇 별명 변경 건너뜀: 서버 ${guild.id}에 '별명 변경' 권한이 없어요.`,
      );
      return;
    }
    await me.setNickname(NICKNAME, "봇 기본 별명");
    console.log(`🏷️ 봇 별명을 "${NICKNAME}"(으)로 바꿨어요 (서버 ${guild.id})`);
  } catch (e) {
    console.error(`봇 별명 변경 실패 (서버 ${guild.id}):`, e.message);
  }
}

/** 준비 완료 후 한 번 호출: 이미 들어가 있는 서버에 적용하고, 앞으로 새로 들어가는 서버에도 적용한다 */
function startBotNickname(client) {
  if (!NICKNAME || NICKNAME.toLowerCase() === "off") return;
  for (const guild of client.guilds.cache.values()) applyNickname(guild);
  client.on(Events.GuildCreate, (guild) => applyNickname(guild)); // 준비 완료 이후의 GuildCreate는 새로 초대된 서버
}

module.exports = { startBotNickname, applyNickname };
