// 서버 관리(모더레이션) 공통 도우미: 대상 검증, 경고 기록, 모더레이션 로그
const { EmbedBuilder } = require("discord.js");
const db = require("../../Database");

db.exec(`
  CREATE TABLE IF NOT EXISTS warning (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason TEXT,
    created_at INTEGER NOT NULL
  )
`);
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_warning_guild_user ON warning(guild_id, user_id);",
);
db.exec(`
  CREATE TABLE IF NOT EXISTS mod_config (
    guild_id TEXT PRIMARY KEY,
    log_channel_id TEXT
  )
`);

const WARNING_KEEP_MS = 365 * 24 * 60 * 60 * 1000; // 경고는 1년 뒤 자동 삭제
const AUTO_TIMEOUT_AT = 3; // 경고 누적 시 자동 타임아웃 기준
const AUTO_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const stmtLogGet = db.prepare(
  "SELECT log_channel_id FROM mod_config WHERE guild_id = ?",
);
const stmtLogSet = db.prepare(
  "INSERT INTO mod_config (guild_id, log_channel_id) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET log_channel_id = excluded.log_channel_id",
);
const stmtLogClear = db.prepare("DELETE FROM mod_config WHERE guild_id = ?");

const { isServerManager } = require("../commands/utils/perm");

/** 실행 가능 여부 확인(서버 소유자·관리자·서버 관리 권한 역할만). 문제가 있으면 안내 문구를 돌려주고, 괜찮으면 null */
function checkActor(interaction) {
  if (!interaction.inGuild()) return "❌ 서버 안에서만 사용할 수 있어요.";
  if (!isServerManager(interaction))
    return "❌ 서버 소유자 또는 서버 관리 권한이 있는 역할만 사용할 수 있어요.";
  return null;
}

/**
 * 대상 멤버에 대한 제재가 가능한지 확인한다 (자기 자신, 소유자, 봇 자신, 나보다 높은 역할 제외).
 * @returns {string|null} 문제가 있으면 안내 문구
 */
function checkTarget(interaction, member, user) {
  if (user.id === interaction.user.id)
    return "❌ 자기 자신에게는 쓸 수 없어요.";
  if (user.id === interaction.client.user.id)
    return "❌ 저에게는 쓸 수 없어요.";
  if (user.id === interaction.guild.ownerId)
    return "❌ 서버 소유자에게는 쓸 수 없어요.";
  if (member && interaction.user.id !== interaction.guild.ownerId) {
    if (
      member.roles.highest.position >= interaction.member.roles.highest.position
    ) {
      return "❌ 나보다 역할이 높거나 같은 사람에게는 쓸 수 없어요.";
    }
  }
  return null;
}

const reasonOf = (r) => (r && r.trim() ? r.trim().slice(0, 200) : "사유 없음");

/** 모더레이션 로그 채널에 기록 (설정되어 있을 때만). 실패해도 조용히 넘어간다 */
async function sendModLog(
  guild,
  { action, targetId, moderatorId, reason, extra },
) {
  const row = stmtLogGet.get(guild.id);
  if (!row?.log_channel_id) return;
  try {
    const ch = await guild.channels.fetch(row.log_channel_id);
    const embed = new EmbedBuilder()
      .setColor("#e67e22")
      .setTitle(`🛡️ ${action}`)
      .addFields(
        { name: "대상", value: `<@${targetId}>`, inline: true },
        { name: "처리자", value: `<@${moderatorId}>`, inline: true },
        { name: "사유", value: reasonOf(reason) },
      )
      .setTimestamp();
    if (extra) embed.addFields({ name: "내용", value: extra });
    await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch {
    /* 채널 삭제·권한 없음은 무시 */
  }
}

module.exports = {
  AUTO_TIMEOUT_AT,
  AUTO_TIMEOUT_MS,
  WARNING_KEEP_MS,
  stmtLogGet,
  stmtLogSet,
  stmtLogClear,
  isServerManager,
  checkActor,
  checkTarget,
  reasonOf,
  sendModLog,
};
