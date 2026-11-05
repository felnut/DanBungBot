const { EmbedBuilder } = require("discord.js");
const db = require("../../Database");
const { kstDate, neisRows, getSchools } = require("../commands/utils/neis");

// 평일 급식 알림: 관리자가 /학교 급식알림설정 설정으로 채널을 정하면 아침에 오늘 급식을 올린다 (이용자 정보 없음, 채널 ID만 저장)
const SEND_FROM_MIN = 7 * 60 + 30; // 07:30
const SEND_UNTIL_MIN = 10 * 60; // 10:00 이후에 켜졌다면 그날은 건너뜀
const CHECK_MS = 30 * 1000;

const stmtAll = db.prepare(
  "SELECT guild_id, channel_id, last_sent FROM lunch_notice",
);
const stmtSent = db.prepare(
  "UPDATE lunch_notice SET last_sent = ? WHERE guild_id = ?",
);
const stmtRemove = db.prepare("DELETE FROM lunch_notice WHERE guild_id = ?");

function normalizeMenu(raw) {
  return String(raw ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/[0-9.()]/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

/** 지정한 학교의 해당일(기본 오늘) 중식 임베드. 급식이 없으면 null (/급식과 급식 알림이 함께 사용) */
async function buildLunchEmbed(school, ymd = kstDate(0).ymd) {
  const rows = await neisRows(school, "mealServiceDietInfo", { MLSV_YMD: ymd });
  const meal = rows.find((r) => r.MMEAL_SC_NM === "중식") ?? rows[0];
  if (!meal) return null;
  return new EmbedBuilder()
    .setColor("#045195")
    .setTitle(`🍴 오늘의 ${meal.MMEAL_SC_NM ?? "급식"}`)
    .setAuthor({ name: school.name })
    .setDescription(`**${ymd.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}**`)
    .addFields({
      name: "메뉴",
      value: `\`\`\`text\n${normalizeMenu(meal.DDISH_NM)}\n\`\`\``,
    })
    .setTimestamp();
}

async function tick(client) {
  const now = kstDate(0);
  const minutes =
    new Date(Date.now() + 9 * 3600e3).getUTCHours() * 60 +
    new Date(Date.now() + 9 * 3600e3).getUTCMinutes();
  if (
    now.dow < 1 ||
    now.dow > 5 ||
    minutes < SEND_FROM_MIN ||
    minutes >= SEND_UNTIL_MIN
  )
    return;

  const pending = stmtAll.all().filter((r) => r.last_sent !== now.iso);
  if (!pending.length) return;

  for (const r of pending) {
    const schools = getSchools(r.guild_id);
    if (!schools.length) continue; // 학교가 등록되지 않은 서버
    // 등록된 학교마다 오늘 급식을 모아 한 번에 올린다 (한 학교가 조회 실패해도 나머지는 올린다)
    const embeds = [];
    let failed = 0;
    for (const school of schools) {
      try {
        const e = await buildLunchEmbed(school, now.ymd);
        if (e) embeds.push(e);
      } catch (err) {
        failed += 1;
        console.error("급식 알림 조회 오류:", err.message);
      }
    }
    if (failed === schools.length) continue; // 전부 실패했으면 다음 확인 때 다시 시도
    stmtSent.run(now.iso, r.guild_id); // 먼저 표시해 중복 전송 방지
    if (!embeds.length) continue; // 급식 없는 날(휴업일 등)
    try {
      const ch = await client.channels.fetch(r.channel_id);
      await ch.send({ embeds, allowedMentions: { parse: [] } });
    } catch (e) {
      console.error(`급식 알림 전송 실패 (서버 ${r.guild_id}):`, e.message);
      if (e.code === 10003 || e.code === 50001) stmtRemove.run(r.guild_id); // 채널 삭제·접근 불가면 설정 해제
    }
  }
}

function startLunchNotice(client) {
  setInterval(
    () =>
      tick(client).catch((e) => console.error("급식 알림 오류:", e.message)),
    CHECK_MS,
  ).unref();
}

module.exports = { startLunchNotice, buildLunchEmbed };
