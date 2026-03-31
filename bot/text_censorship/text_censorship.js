const { EmbedBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");

function getFilter() {
  try {
    const data = fs.readFileSync(path.join(__dirname, "filter.json"), "utf8");
    const json = JSON.parse(data);
    return json;
  } catch (err) {
    console.error("필터 파일 로드 실패:", err);
    return {};
  }
}

module.exports = (client) => {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.content) return;

    const filter = getFilter();
    let content = message.content;
    let modified = false;

    // 필터 단어 치환 및 검출
    for (const [key, words] of Object.entries(filter)) {
      for (const word of words) {
        const regex = new RegExp(word, "gi");
        if (regex.test(content)) {
          content = content.replace(regex, key);
          modified = true;
        }
      }
    }

    // 금지어 포함된 경우 처리
    if (modified) {
      try {
        // 원본 메시지 삭제 (가능하면)
        if (message.deletable) {
          await message.delete();
        }

        // 검열 완료 메시지 전송
        const filterEmbed = new EmbedBuilder()
          .setColor(0x00ff7f)
          .setTitle("검열 딱!")
          .setAuthor({
            name: message.author.username,
            iconURL: message.author.displayAvatarURL(),
          })
          .setDescription(`### ${content}`)
          .setTimestamp();

        await message.channel.send({ embeds: [filterEmbed] });
      } catch (err) {
        console.error("검열 처리 중 오류:", err);
      }
    }
  });
};
