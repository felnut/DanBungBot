const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const { isServerAdmin } = require("./perm");
const db = require("../../../Database");
const { kstDate } = require("./neis");

const MAX_PER_GUILD = 20;
const MAX_PER_USER = 3;
const EPHEMERAL = MessageFlags.Ephemeral;

const stmtInsert = db.prepare(
  "INSERT INTO dday (guild_id, name, date, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
);
const stmtList = db.prepare(
  "SELECT id, name, date, created_by FROM dday WHERE guild_id = ? AND date >= ? ORDER BY date ASC, id ASC",
);
const stmtGet = db.prepare(
  "SELECT id, created_by FROM dday WHERE id = ? AND guild_id = ?",
);
const stmtDelete = db.prepare("DELETE FROM dday WHERE id = ? AND guild_id = ?");
const stmtCountGuild = db.prepare(
  "SELECT COUNT(*) AS n FROM dday WHERE guild_id = ? AND date >= ?",
);
const stmtCountUser = db.prepare(
  "SELECT COUNT(*) AS n FROM dday WHERE guild_id = ? AND created_by = ? AND date >= ?",
);

/** YYYY-MM-DD가 실제 달력에 있는 날짜인지 */
function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 오늘(KST)부터 target(YYYY-MM-DD)까지 남은 일수 */
function daysUntil(target, todayIso) {
  return Math.round(
    (Date.parse(`${target}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) /
      86400000,
  );
}

module.exports = {
  isRealDate,
  daysUntil,
  data: new SlashCommandBuilder()
    .setName("디데이")
    .setDescription("서버 D-day 목록 (시험·행사 날짜 세기)")
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("추가")
        .setDescription("D-day 추가")
        .addStringOption((o) =>
          o
            .setName("이름")
            .setDescription("예: 기말고사 (개인정보는 적지 마세요)")
            .setRequired(true)
            .setMaxLength(30),
        )
        .addIntegerOption((o) =>
          o
            .setName("년")
            .setDescription("예: 2026")
            .setRequired(true)
            .setMinValue(2000)
            .setMaxValue(2100),
        )
        .addIntegerOption((o) =>
          o
            .setName("월")
            .setDescription("1~12")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(12),
        )
        .addIntegerOption((o) =>
          o
            .setName("일")
            .setDescription("1~31")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(31),
        ),
    )
    .addSubcommand((s) => s.setName("목록").setDescription("남은 D-day 보기"))
    .addSubcommand((s) =>
      s
        .setName("삭제")
        .setDescription("D-day 삭제 (내가 만든 것 또는 관리자)")
        .addIntegerOption((o) =>
          o
            .setName("번호")
            .setDescription("목록에 표시된 #번호")
            .setRequired(true)
            .setMinValue(1),
        ),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "❌ 서버 안에서만 사용할 수 있어요.",
        flags: EPHEMERAL,
      });
    }
    const guildId = interaction.guildId;
    const today = kstDate(0).iso;
    const sub = interaction.options.getSubcommand();

    if (sub === "추가") {
      const name = interaction.options
        .getString("이름")
        .trim()
        .replace(/\s+/g, " ");
      const y = interaction.options.getInteger("년");
      const m = interaction.options.getInteger("월");
      const dd = interaction.options.getInteger("일");
      const date = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
      if (!name)
        return interaction.reply({
          content: "❌ 이름을 입력해 주세요.",
          flags: EPHEMERAL,
        });
      if (!isRealDate(date)) {
        return interaction.reply({
          content: `❌ ${y}년 ${m}월 ${dd}일은 없는 날짜예요. 년·월·일을 다시 확인해 주세요.`,
          flags: EPHEMERAL,
        });
      }
      if (date < today)
        return interaction.reply({
          content: "❌ 이미 지난 날짜예요.",
          flags: EPHEMERAL,
        });
      if (daysUntil(date, today) > 366 * 3) {
        return interaction.reply({
          content: "❌ 3년 안의 날짜만 등록할 수 있어요.",
          flags: EPHEMERAL,
        });
      }
      if (stmtCountGuild.get(guildId, today).n >= MAX_PER_GUILD) {
        return interaction.reply({
          content: `❌ 서버 D-day는 최대 ${MAX_PER_GUILD}개예요. 지난 항목을 삭제해 주세요.`,
          flags: EPHEMERAL,
        });
      }
      if (
        stmtCountUser.get(guildId, interaction.user.id, today).n >= MAX_PER_USER
      ) {
        return interaction.reply({
          content: `❌ 한 사람이 등록할 수 있는 D-day는 최대 ${MAX_PER_USER}개예요.`,
          flags: EPHEMERAL,
        });
      }
      const id = stmtInsert.run(
        guildId,
        name,
        date,
        interaction.user.id,
        Date.now(),
      ).lastInsertRowid;
      const d = daysUntil(date, today);
      return interaction.reply(
        `✅ **${name}** (${date}) 등록! ${d === 0 ? "오늘이에요 🎉" : `D-${d}`}  · 삭제: \`/유틸 디데이 삭제 번호:${id}\``,
      );
    }

    if (sub === "목록") {
      const rows = stmtList.all(guildId, today);
      if (!rows.length) {
        return interaction.reply({
          content:
            "등록된 D-day가 없어요. `/유틸 디데이 추가`로 만들어 보세요!",
          flags: EPHEMERAL,
        });
      }
      const lines = rows.map((r) => {
        const d = daysUntil(r.date, today);
        return `\`${d === 0 ? "D-DAY" : `D-${d}`}\` **${r.name}** · ${r.date} · #${r.id}`;
      });
      const embed = new EmbedBuilder()
        .setColor("#f1c40f")
        .setTitle("⏳ D-day")
        .setDescription(lines.join("\n"))
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // 삭제
    const id = interaction.options.getInteger("번호");
    const row = stmtGet.get(id, guildId);
    if (!row)
      return interaction.reply({
        content: "❌ 그런 번호의 D-day가 없어요.",
        flags: EPHEMERAL,
      });
    if (row.created_by !== interaction.user.id && !isServerAdmin(interaction)) {
      return interaction.reply({
        content: "❌ 내가 만든 D-day만 삭제할 수 있어요.",
        flags: EPHEMERAL,
      });
    }
    stmtDelete.run(id, guildId);
    return interaction.reply({ content: "🗑️ 삭제했어요.", flags: EPHEMERAL });
  },
};
