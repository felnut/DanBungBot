const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const {
  kstDate,
  shortDate,
  neisRows,
  requireSchool,
  addSchoolOption,
  schoolAutocomplete,
} = require("./neis");

const daysBetween = (fromIso, ymd) =>
  Math.round(
    (Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) -
      Date.parse(`${fromIso}T00:00:00Z`)) /
      86400000,
  );

module.exports = {
  data: new SlashCommandBuilder()
    .setName("일정검색")
    .setDescription(
      "학사일정에서 키워드로 다음 일정을 찾아요 (예: 기말고사, 방학, 수능)",
    )
    .addStringOption((o) =>
      o
        .setName("키워드")
        .setDescription("찾을 단어")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(20),
    ),

  async execute(interaction) {
    const school = await requireSchool(interaction);
    if (!school) return;
    await interaction.reply("🔎 일정을 찾는 중…");
    const keyword = interaction.options.getString("키워드").trim();
    const today = kstDate(0);

    try {
      const rows = await neisRows(school, "SchoolSchedule", {
        AA_FROM_YMD: today.ymd,
        AA_TO_YMD: kstDate(365).ymd,
        pSize: 1000,
      });
      const hits = rows
        .filter((r) => r.EVENT_NM.toLowerCase().includes(keyword.toLowerCase()))
        .sort((a, b) => a.AA_YMD.localeCompare(b.AA_YMD))
        .slice(0, 10);
      if (!hits.length) {
        return await interaction.editReply(
          `📭 앞으로 1년 안에 "${keyword.slice(0, 20)}"이(가) 들어간 학사일정이 없어요.`,
        );
      }
      const lines = hits.map((r) => {
        const d = daysBetween(today.iso, r.AA_YMD);
        return `\`${d === 0 ? "D-DAY" : `D-${d}`}\` ${shortDate(r.AA_YMD)} ${r.EVENT_NM}`;
      });
      const embed = new EmbedBuilder()
        .setColor("#045195")
        .setTitle(`🔎 "${keyword.slice(0, 20)}" 일정`)
        .setAuthor({ name: school.name })
        .setDescription(lines.join("\n"))
        .setTimestamp();
      await interaction.editReply({ content: "", embeds: [embed] });
    } catch (e) {
      console.error("일정검색 오류:", e.message);
      await interaction.editReply(
        "🚨 일정을 찾는 중에 오류가 발생했어요. 잠시 후 다시 시도해 주세요.",
      );
    }
  },
};

// 여러 학교를 등록한 서버에서 학교를 고를 수 있게 한다 (비우면 기본 학교)
addSchoolOption(module.exports.data);
module.exports.autocomplete = schoolAutocomplete;
