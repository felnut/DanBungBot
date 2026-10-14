const { EmbedBuilder } = require("discord.js");
const db = require("../../../Database");
const { games, saveGame, deleteGame } = require("../../commands/utils/gameState");
const { rewardFor } = require("../../commands/game/baseball");
const cache = require("../../commands/utils/cache");

module.exports = (client) => {
  client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.inGuild() || !games.has(message.author.id))
      return;

    const content = message.content.trim();

    // 4자리 숫자인데 규칙에 어긋나면(0 포함·중복) 시도 횟수는 올리지 않고 이유를 알려 준다
    if (/^\d{4}$/.test(content) && (!/^[1-9]{4}$/.test(content) || new Set(content).size !== 4)) {
      await message
        .reply("❌ **0이 없고 서로 다른 1~9 숫자 4개**만 입력할 수 있어요! (시도 횟수는 늘지 않았어요)")
        .catch(() => {});
      return;
    }
    if (!/^[1-9]{4}$/.test(content)) return;

    const game = games.get(message.author.id);
    if (!game) return; // 안전한 접근

    game.tries += 1;
    const guess = content.split("").map(Number);
    const { s: strike, b: ball } = checkGuess(guess, game.answer);

    game.history.push({ guess: content, s: strike, b: ball });
    if (game.history.length > 10) game.history.shift();
    saveGame(message.author.id);

    const embed = new EmbedBuilder()
      .setColor(strike === 4 ? "#00cc99" : "#3498db")
      .setTitle(strike === 4 ? "🎉 정답!" : `시도 ${game.tries}회`)
      .setDescription(
        strike === 4
          ? `**${content}** → ${strike}S ${ball}B\n축하해요! 정답 맞췄습니다!`
          : `**${content}** → **${strike}S ${ball}B**`,
      )
      .addFields({
        name: "기록",
        value: game.history
          .map((entry, i) => `${i + 1}. **${entry.guess}** → ${entry.s}S ${entry.b}B`)
          .join("\n"),
        inline: false,
      });

    if (strike === 4) {
      const reward = rewardFor(game.tries);
      const changes = db
        .prepare("UPDATE user SET money = money + ? WHERE user_id = ?")
        .run(reward, message.author.id).changes;
      if (!changes) return; // safety

      cache.del(`leaderboard:money:myRank:${message.author.id}`);
      cache.del("leaderboard:money:top10");

      embed
        .setColor("#57f287")
        .setDescription(`**${content}** → 4S 정답!\n${reward.toLocaleString()}원 지급됐어요! 🎉`)
        .addFields({ name: "💰 보상", value: `+${reward.toLocaleString()}원`, inline: true });

      deleteGame(message.author.id);
    } else if (game.tries >= game.maxTries) {
      embed
        .setColor("#ff4444")
        .setDescription(
          `10번 다 썼어요... 아쉽네요 ㅠㅠ\n정답은 **${game.answer.join("")}** 였습니다.`,
        )
        .addFields({ name: "결과", value: "게임 종료", inline: true });

      deleteGame(message.author.id);
    }

    await message.reply({ embeds: [embed] });
  });
};

/**
 * 스트라이크/볼 계산 함수
 * @param {number[]} guess 사용자가 입력한 숫자 배열
 * @param {number[]} answer 정답 배열
 * @returns {{s: number, b: number}} strike와 ball 개수
 */
function checkGuess(guess, answer) {
  let strike = 0;
  let ball = 0;
  for (let i = 0; i < 4; i++) {
    if (guess[i] === answer[i]) {
      strike += 1;
    } else if (answer.includes(guess[i])) {
      ball += 1;
    }
  }
  return { s: strike, b: ball };
}
