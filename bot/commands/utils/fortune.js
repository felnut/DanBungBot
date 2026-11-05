const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const crypto = require("node:crypto");

const AREAS = ["💰 재물", "💕 인연", "📚 학업·일", "💪 건강"];
const COLORS = [
  "빨강",
  "주황",
  "노랑",
  "초록",
  "파랑",
  "남색",
  "보라",
  "하양",
  "검정",
  "분홍",
];
const MESSAGES = [
  [0, "오늘은 한 박자 쉬어가요. 서두르면 놓치는 게 생겨요."],
  [30, "무난한 하루예요. 작은 약속을 잘 지키면 흐름이 좋아져요."],
  [55, "차분히 하던 일을 이어가면 성과가 나와요."],
  [75, "좋은 기운이 따라요. 미뤄 둔 일을 시작하기 좋은 날이에요."],
  [90, "뭘 해도 잘 풀리는 날! 자신 있게 도전해 보세요."],
];

/** 같은 사람이 같은 날 다시 봐도 결과가 같도록, 사용자 ID와 날짜(한국 시간)로 값을 만든다 */
function seedBytes(userId) {
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return crypto
    .createHash("sha256")
    .update(`fortune:${userId}:${today}`)
    .digest();
}

const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("운세")
    .setDescription("오늘의 운세를 봐요 (하루에 한 가지 결과로 고정돼요)"),

  async execute(interaction) {
    const b = seedBytes(interaction.user.id);
    const score = b[0] % 101;
    const message = [...MESSAGES].reverse().find(([min]) => score >= min)[1];
    const areas = AREAS.map(
      (name, i) => `${name}  ${stars(1 + (b[i + 1] % 5))}`,
    ).join("\n");
    const embed = new EmbedBuilder()
      .setColor(score >= 75 ? 0x57f287 : score >= 40 ? 0x5865f2 : 0xfee75c)
      .setTitle(`🔮 ${interaction.user.displayName}님의 오늘 운세`)
      .setDescription(`**${score}점**\n${message}`)
      .addFields(
        { name: "분야별 운", value: areas },
        { name: "행운의 숫자", value: String(1 + (b[5] % 45)), inline: true },
        {
          name: "행운의 색",
          value: COLORS[b[6] % COLORS.length],
          inline: true,
        },
      )
      .setFooter({ text: "재미로 보는 운세예요" });
    return interaction.reply({ embeds: [embed] });
  },
};
