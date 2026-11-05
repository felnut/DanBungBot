const { SlashCommandBuilder } = require("discord.js");
const {
  kstDate,
  requireSchool,
  addSchoolOption,
  schoolAutocomplete,
} = require("./neis");
const { buildLunchEmbed } = require("../../managers/lunchNotice");

/** 월/일을 받아 올해 YYYYMMDD로 */
function ymdOf(month, day) {
  const year = kstDate(0).iso.slice(0, 4);
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("급식")
    .setDescription("급식을 알려줘요!")
    .addNumberOption((o) =>
      o
        .setName("월")
        .setDescription("월을 입력해주세요. 입력하지 않으면 현재 월입니다.")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(12),
    )
    .addNumberOption((o) =>
      o
        .setName("일")
        .setDescription("일을 입력해주세요. 입력하지 않으면 현재 일입니다.")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(31),
    )
    .addStringOption((o) =>
      o
        .setName("날짜")
        .setDescription("오늘 또는 내일. 입력하면 월/일 옵션은 무시됩니다.")
        .setRequired(false)
        .addChoices(
          { name: "오늘", value: "today" },
          { name: "내일", value: "tomorrow" },
        ),
    ),

  async execute(interaction) {
    const school = await requireSchool(interaction);
    if (!school) return;
    try {
      // "생각 중…" 표시 대신 즉시 응답하고, 결과가 나오면 이 메시지를 수정한다
      await interaction.reply("🍽️ 급식 정보를 불러오는 중…");

      const keyword = interaction.options.getString("날짜");
      const today = kstDate(0);
      let ymd;
      if (keyword === "today") ymd = today.ymd;
      else if (keyword === "tomorrow") ymd = kstDate(1).ymd;
      else {
        ymd = ymdOf(
          interaction.options.getNumber("월") ?? today.month,
          interaction.options.getNumber("일") ?? today.day,
        );
      }

      const embed = await buildLunchEmbed(school, ymd);
      if (!embed) {
        return await interaction.editReply(
          `📭 ${ymd.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}의 급식 정보가 없습니다.`,
        );
      }
      await interaction.editReply({ content: "", embeds: [embed] });
    } catch (error) {
      // NEIS 오류 객체에는 요청 주소의 API 키가 들어 있으므로 메시지만 기록한다
      console.error("급식 조회 오류:", error?.message);
      await interaction.editReply(
        "🚨 급식을 불러오는 중에 오류가 발생했습니다.",
      );
    }
  },
};

// 여러 학교를 등록한 서버에서 학교를 고를 수 있게 한다 (비우면 기본 학교)
addSchoolOption(module.exports.data);
module.exports.autocomplete = schoolAutocomplete;
