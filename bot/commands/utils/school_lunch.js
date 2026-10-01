const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const cache = require("./cache");

function formatDateOption(value, fallback) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return String(fallback).padStart(2, "0");
  }
  return String(value).padStart(2, "0");
}

function normalizeMenu(rawMenu) {
  if (!rawMenu || typeof rawMenu !== "string") return "정보가 없습니다.";
  return rawMenu
    .replace(/<br\s*\/?/gi, "\n")
    .replace(/[0-9.()]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("급식")
    .setDescription("급식을 알려줘요!")
    .addNumberOption((option) =>
      option
        .setName("월")
        .setDescription("월을 입력해주세요. 입력하지 않으면 현재 월입니다.")
        .setRequired(false),
    )
    .addNumberOption((option) =>
      option
        .setName("일")
        .setDescription("일을 입력해주세요. 입력하지 않으면 현재 일입니다.")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("날짜")
        .setDescription("오늘 또는 내일. 입력하면 월/일 옵션은 무시됩니다.")
        .setRequired(false)
        .addChoices(
          { name: "오늘", value: "today" },
          { name: "내일", value: "tomorrow" },
        ),
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply();

      const now = new Date();
      const dateKeyword = interaction.options.getString("날짜");
      let queryDate;

      if (dateKeyword === "today") {
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        queryDate = `${year}${month}${day}`;
      } else if (dateKeyword === "tomorrow") {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const year = tomorrow.getFullYear();
        const month = String(tomorrow.getMonth() + 1).padStart(2, "0");
        const day = String(tomorrow.getDate()).padStart(2, "0");
        queryDate = `${year}${month}${day}`;
      } else {
        const monthOption = interaction.options.getNumber("월");
        const dayOption = interaction.options.getNumber("일");
        const year = now.getFullYear();
        const month = formatDateOption(monthOption, now.getMonth() + 1);
        const day = formatDateOption(dayOption, now.getDate());
        queryDate = `${year}${month}${day}`;
      }

      const mealInfo = await cache.getOrSet(
        `schoolLunch:${queryDate}`,
        30 * 60 * 1000,
        async () => {
          const response = await axios.get(
            "https://open.neis.go.kr/hub/mealServiceDietInfo",
            {
              params: {
                KEY: process.env.NEIS_KEY || process.env.NEIS_TOKEN,
                Type: "json",
                ATPT_OFCDC_SC_CODE: "B10",
                SD_SCHUL_CODE: "7011489",
                MLSV_YMD: queryDate,
              },
            },
          );

          return response.data?.mealServiceDietInfo?.[1]?.row?.[0] || null;
        },
      );
      if (!mealInfo) {
        const y = queryDate.slice(0, 4);
        const m = queryDate.slice(4, 6);
        const d = queryDate.slice(6, 8);
        return await interaction.editReply(`📭 ${y}-${m}-${d}의 급식 정보가 없습니다.`);
      }

      const normalizedMenu = normalizeMenu(mealInfo.DDISH_NM);
      const mealEmbed = new EmbedBuilder()
        .setColor("#045195")
        .setTitle("🍴 급식 메뉴")
        .setAuthor({ name: "단국대학교부속소프트웨어고등학교" })
        .setDescription(`**${mealInfo.MLSV_YMD.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}**\n`)
        .addFields({
          name: "메뉴",
          value: `\`\`\`text\n${normalizedMenu}\n\`\`\``,
          inline: false,
        })
        .setThumbnail("https://cdn-icons-png.flaticon.com/512/3480/3480823.png")
        .setTimestamp();

      await interaction.editReply({ embeds: [mealEmbed] });
    } catch (error) {
      console.error(error);
      await interaction.editReply("🚨 급식을 불러오는 중에 오류가 발생했습니다.");
    }
  },
};
