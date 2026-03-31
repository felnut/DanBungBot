const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const axios = require("axios");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("급식")
    .setDescription("급식을 알려줘요!")
    .addNumberOption((Option) =>
      Option.setName("월")
        .setDescription(
          "월을 입력해주세요.(입력하지 않으면 현재 월로 입력됩니다.)",
        )
        .setRequired(false),
    )
    .addNumberOption((Option) =>
      Option.setName("일")
        .setDescription(
          "일을 입력해주세요.(입력하지 않으면 현재 일로 입력됩니다.)",
        )
        .setRequired(false),
    )
    .addStringOption((Option) =>
      Option.setName("날짜")
        .setDescription("오늘 또는 내일 (입력하면 월/일 옵션은 무시됩니다.)")
        .setRequired(false)
        .addChoices(
          { name: "오늘", value: "today" },
          { name: "내일", value: "tomorrow" },
        ),
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply();

      // 날짜 결정 (오늘/내일 우선, 아니면 직접 입력받은 월/일)
      const dateKeyword = interaction.options.getString("날짜");
      let finalYear, finalMonth, finalDay;

      const now = new Date();

      if (dateKeyword === "today") {
        finalYear = now.getFullYear();
        finalMonth = String(now.getMonth() + 1).padStart(2, "0");
        finalDay = String(now.getDate()).padStart(2, "0");
      } else if (dateKeyword === "tomorrow") {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        finalYear = tomorrow.getFullYear();
        finalMonth = String(tomorrow.getMonth() + 1).padStart(2, "0");
        finalDay = String(tomorrow.getDate()).padStart(2, "0");
      } else {
        finalYear = now.getFullYear();
        finalMonth = String(
          interaction.options.getNumber("월") ?? now.getMonth() + 1,
        ).padStart(2, "0");
        finalDay = String(
          interaction.options.getNumber("일") ?? now.getDate(),
        ).padStart(2, "0");
      }

      // NEIS 교육청 API 호출
      const response = await axios.get(
        `https://open.neis.go.kr/hub/mealServiceDietInfo`,
        {
          params: {
            KEY: process.env.NEIS_KEY,
            Type: "json",
            ATPT_OFCDC_SC_CODE: "B10",
            SD_SCHUL_CODE: "7011489",
            MLSV_YMD: `${finalYear}${finalMonth}${finalDay}`,
          },
        },
      );

      const data = response.data;

      if (data.mealServiceDietInfo) {
        const row = data.mealServiceDietInfo[1].row[0];
        const menu = row.DDISH_NM.split("<br/>")
          .join("\n")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/[0-9.()]/g, "")
          .trim();

        const mealEmbed = new EmbedBuilder()
          .setColor("#045195")
          .setTitle(`🍴 급식 메뉴`)
          .setAuthor({ name: "단국대학교부속소프트웨어고등학교" })
          .setDescription(
            `**${row.MLSV_YMD.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}**\n`,
          )
          .addFields({
            name: "메뉴",
            value: `\`\`\`text\n${menu}\n\`\`\``,
            inline: false,
          })
          .setThumbnail(
            "https://cdn-icons-png.flaticon.com/512/3480/3480823.png",
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [mealEmbed] });
      } else {
        await interaction.editReply(
          `📭 ${finalYear}-${finalMonth}-${finalDay}의 급식 정보가 없습니다.`,
        );
      }
    } catch (error) {
      console.error(error);
      await interaction.editReply(
        "🚨 급식을 불러오는 중에 오류가 발생했습니다.",
      );
    }
  },
};
