const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const {
  kstDate,
  shortDate,
  neisRows,
  requireSchool,
  addSchoolOption,
  schoolAutocomplete,
} = require("./neis");

/** 범위 선택지 → [시작, 끝] (YYYYMMDD) */
function rangeOf(kind) {
  const today = kstDate(0);
  if (kind === "month" || kind === "next") {
    const [y, m] = today.iso.split("-").map(Number);
    const base =
      kind === "month"
        ? new Date(Date.UTC(y, m - 1, 1))
        : new Date(Date.UTC(y, m, 1));
    const last = new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0),
    );
    const f = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
    return [kind === "month" ? today.ymd : f(base), f(last)];
  }
  return [today.ymd, kstDate(30).ymd];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("학사일정")
    .setDescription("우리 학교 학사일정을 알려줘요!")
    .addStringOption((o) =>
      o
        .setName("범위")
        .setDescription("기본: 앞으로 30일")
        .addChoices(
          { name: "앞으로 30일", value: "30" },
          { name: "이번 달 (오늘부터)", value: "month" },
          { name: "다음 달", value: "next" },
        ),
    ),

  async execute(interaction) {
    const school = await requireSchool(interaction);
    if (!school) return;
    await interaction.reply("📅 학사일정을 불러오는 중…");
    const kind = interaction.options.getString("범위") ?? "30";
    const [from, to] = rangeOf(kind);

    try {
      const rows = await neisRows(school, "SchoolSchedule", {
        AA_FROM_YMD: from,
        AA_TO_YMD: to,
      });
      if (!rows.length) {
        return await interaction.editReply(
          "📭 해당 기간에 등록된 학사일정이 없어요.",
        );
      }
      rows.sort((a, b) => a.AA_YMD.localeCompare(b.AA_YMD));
      const lines = rows
        .slice(0, 30)
        .map((r) => `\`${shortDate(r.AA_YMD)}\` ${r.EVENT_NM}`);
      const more = rows.length - 30;
      const embed = new EmbedBuilder()
        .setColor("#045195")
        .setTitle("📅 학사일정")
        .setAuthor({ name: school.name })
        .setDescription(
          `${lines.join("\n")}${more > 0 ? `\n… 외 ${more}건` : ""}`.slice(
            0,
            4000,
          ),
        )
        .setFooter({ text: `${shortDate(from)} ~ ${shortDate(to)}` })
        .setTimestamp();
      await interaction.editReply({ content: "", embeds: [embed] });
    } catch (e) {
      console.error("학사일정 조회 오류:", e.message);
      await interaction.editReply(
        "🚨 학사일정을 불러오는 중에 오류가 발생했어요. 잠시 후 다시 시도해 주세요.",
      );
    }
  },
};

// 여러 학교를 등록한 서버에서 학교를 고를 수 있게 한다 (비우면 기본 학교)
addSchoolOption(module.exports.data);
module.exports.autocomplete = schoolAutocomplete;
