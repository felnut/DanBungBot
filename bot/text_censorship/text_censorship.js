const { EmbedBuilder } = require("discord.js");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const filterFilePath = path.join(__dirname, "filter.json");
let compiledFilterPatterns = [];

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loadFilter() {
  try {
    const raw = await fsp.readFile(filterFilePath, "utf8");
    const parsed = JSON.parse(raw);

    const nextPatterns = [];
    for (const [replacement, words] of Object.entries(parsed)) {
      for (const word of words) {
        if (typeof word !== "string" || !word.trim()) continue;
        nextPatterns.push({
          regex: new RegExp(escapeRegExp(word), "gi"),
          replacement,
        });
      }
    }
    compiledFilterPatterns = nextPatterns;
  } catch (err) {
    console.error("필터 파일 로드 실패:", err);
    compiledFilterPatterns = [];
  }
}

let reloadTimer = null;
function scheduleReload() {
  if (reloadTimer) return;
  reloadTimer = setTimeout(async () => {
    reloadTimer = null;
    await loadFilter();
  }, 200);
}

module.exports = (client) => {
  // 1) 초기 로드 1회 (핫패스 밖)
  loadFilter();

  // 2) 파일 변경 감지 (핫패스에서 stat/readFile 제거)
  try {
    fs.watch(filterFilePath, { persistent: false }, () => {
      scheduleReload();
    });
  } catch (err) {
    console.error("필터 파일 watch 실패:", err);
  }

  client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.inGuild() || !message.content) return;

    const patterns = compiledFilterPatterns;
    if (!patterns.length) return;

    let content = message.content;
    let modified = false;

    for (const { regex, replacement } of patterns) {
      regex.lastIndex = 0; // global regex state safety
      const next = content.replace(regex, replacement);
      if (next !== content) {
        content = next;
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
