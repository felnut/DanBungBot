const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("봇의 응답 속도와 API 지연 시간을 확인합니다."),

  async execute(interaction) {
    // 먼저 임시 응답 (로딩 중 표시용)
    const response = await interaction.deferReply({ withResponse: true });

    // 메시지 지연 시간 계산 (사용자 입력 → 봇 응답까지)
    const latency =
      response.resource.message.createdTimestamp - interaction.createdTimestamp;

    // 웹소켓 핑 (디스코드 서버와 실시간 연결 상태)
    const wsPing = interaction.client.ws.ping;
    const wsDisplay = wsPing === -1 ? `${latency}ms (예상)` : `${wsPing}ms`;

    // 결과 임베드 생성
    const finalEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🏓 퐁!")
      .addFields(
        {
          name: "✉️ 메시지 지연 시간",
          value: `\`${latency}ms\``,
          inline: true,
        },
        { name: "⚙️ API 지연 시간", value: `\`${wsDisplay}\``, inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [finalEmbed] });
  },
};
