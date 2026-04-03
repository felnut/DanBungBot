const { EmbedBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");

const filterFilePath = path.join(__dirname, "filter.json");
let cachedFilter = null;
let cachedFilterMtime = 0;
let compiledFilterPatterns = [];

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadFilter() {
  try {
    const stat = fs.statSync(filterFilePath);
    if (cachedFilter && stat.mtimeMs === cachedFilterMtime) {
      return;
    }

    const raw = fs.readFileSync(filterFilePath, "utf8");
    const parsed = JSON.parse(raw);
    cachedFilter = parsed;
    cachedFilterMtime = stat.mtimeMs;

    compiledFilterPatterns = [];
    for (const [replacement, words] of Object.entries(parsed)) {
      for (const word of words) {
        if (typeof word !== "string" || !word.trim()) continue;
        compiledFilterPatterns.push({
          regex: new RegExp(escapeRegExp(word), "gi"),
          replacement,
        });
      }
    }
  } catch (err) {
    console.error("필터 파일 로드 실패:", err);
    cachedFilter = {};
    compiledFilterPatterns = [];
  }
}

function getFilterPatterns() {
  if (!cachedFilter) {
    loadFilter();
  } else {
    try {
      const stat = fs.statSync(filterFilePath);
      if (stat.mtimeMs !== cachedFilterMtime) {
        loadFilter();
      }
    } catch (err) {
      // 파일이 삭제된 상황 등 예외 처리
      console.error("필터 파일 상태 확인 실패:", err);
      cachedFilter = {};
      compiledFilterPatterns = [];
    }
  }

  return compiledFilterPatterns;
}

module.exports = (client) => {
  client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.inGuild() || !message.content) return;

    const patterns = getFilterPatterns();
    if (!patterns.length) return;

    let content = message.content;
    let modified = false;

    for (const { regex, replacement } of patterns) {
      if (regex.test(content)) {
        content = content.replace(regex, replacement);
        modified = true;
      }
    }

    if (!modified) return;

    try {
      if (message.deletable) {
        await message.delete();
      }

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
  });
};
