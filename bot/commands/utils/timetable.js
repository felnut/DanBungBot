const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const {
  kstDate,
  neisRows,
  requireSchool,
  addSchoolOption,
  schoolAutocomplete,
} = require("./neis");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("시간표")
    .setDescription("우리 학교 학급 시간표를 알려줘요!")
    .addIntegerOption((o) =>
      o
        .setName("학년")
        .setDescription("학년")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(6),
    )
    .addIntegerOption((o) =>
      o
        .setName("반")
        .setDescription("반")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(20),
    )
    .addStringOption((o) =>
      o
        .setName("날짜")
        .setDescription("기본: 오늘")
        .addChoices(
          { name: "오늘", value: "0" },
          { name: "내일", value: "1" },
          { name: "모레", value: "2" },
        ),
    ),

  async execute(interaction) {
    const school = await requireSchool(interaction);
    if (!school) return;
    const grade = interaction.options.getInteger("학년");
    if (!school.timetableService || grade > school.maxGrade) {
      return interaction.reply({
        content: school.timetableService
          ? `❌ ${school.name}은(는) ${school.maxGrade}학년까지 있어요.`
          : "❌ 이 학교 종류는 시간표 조회를 지원하지 않아요.",
        flags: 64,
      });
    }
    await interaction.reply("🕘 시간표를 불러오는 중…");
    const cls = interaction.options.getInteger("반");
    const day = kstDate(Number(interaction.options.getString("날짜") ?? "0"));

    try {
      const rows = await neisRows(school, school.timetableService, {
        ALL_TI_YMD: day.ymd,
        GRADE: String(grade),
        CLASS_NM: String(cls),
      });
      if (!rows.length) {
        return await interaction.editReply(
          `📭 ${day.iso}(${day.weekday}) ${grade}학년 ${cls}반 시간표가 없어요. (주말·휴업일이거나 아직 등록 전일 수 있어요)`,
        );
      }

      // 학과별로 시간표가 다를 수 있어 학과 단위로 묶는다
      const byDept = new Map();
      for (const r of rows) {
        const dept = r.DDDEP_NM || "공통";
        if (!byDept.has(dept)) byDept.set(dept, []);
        byDept.get(dept).push(r);
      }

      const embed = new EmbedBuilder()
        .setColor("#045195")
        .setTitle(`🗓️ ${grade}학년 ${cls}반 시간표`)
        .setAuthor({ name: school.name })
        .setDescription(`**${day.iso} (${day.weekday})**`)
        .setTimestamp();

      for (const [dept, list] of [...byDept].slice(0, 5)) {
        list.sort((a, b) => Number(a.PERIO) - Number(b.PERIO));
        embed.addFields({
          name: byDept.size > 1 ? `📚 ${dept}` : "📚 수업",
          value: list
            .map((r) => `**${r.PERIO}교시** ${r.ITRT_CNTNT}`)
            .join("\n")
            .slice(0, 1024),
          inline: byDept.size > 1,
        });
      }
      await interaction.editReply({ content: "", embeds: [embed] });
    } catch (e) {
      console.error("시간표 조회 오류:", e.message);
      await interaction.editReply(
        "🚨 시간표를 불러오는 중에 오류가 발생했어요. 잠시 후 다시 시도해 주세요.",
      );
    }
  },
};

// 여러 학교를 등록한 서버에서 학교를 고를 수 있게 한다 (비우면 기본 학교)
addSchoolOption(module.exports.data);
module.exports.autocomplete = schoolAutocomplete;
