const { EmbedBuilder } = require("discord.js");
const db = require("../../../Database");
const { games } = require("../../commands/utils/gameState"); // 경로가 프로젝트 구조에 따라 달라질 수 있음

module.exports = (client) => {
  client.on("messageCreate", async (message) => {
    // 봇 메시지, DM, 게임 중이 아닌 경우 무시
    if (message.author.bot) return;
    if (!message.inGuild()) return;
    if (!games.has(message.author.id)) return;

    const content = message.content.trim();

    // 1~9 중복 없는 4자리 숫자인지 검사
    if (/^[1-9]{4}$/.test(content) && new Set(content).size === 4) {
      const game = games.get(message.author.id);
      game.tries++;

      const guess = content.split("").map(Number);
      const { s: strike, b: ball } = checkGuess(guess, game.answer);

      // 히스토리에 기록
      game.history.push({ guess: content, s: strike, b: ball });

      // 결과 메시지
      const embed = new EmbedBuilder()
        .setColor(strike === 4 ? "#00cc99" : "#3498db")
        .setTitle(strike === 4 ? "🎉 정답!" : `시도 ${game.tries}회`)
        .setDescription(
          strike === 4
            ? `**${content}** → ${strike}S ${ball}B\n축하해요! 정답 맞췄습니다!`
            : `**${content}** → **${strike}S ${ball}B**`,
        );

      // 히스토리 보여주기
      const historyText = game.history
        .map(
          (entry, i) =>
            `${i + 1}. **${entry.guess}** → ${entry.s}S ${entry.b}B`,
        )
        .join("\n");

      embed.addFields({
        name: "기록",
        value: historyText || "아직 추측이 없습니다.",
        inline: false,
      });

      // 정답 맞췄을 때 게임 종료 + 보상 지급
      if (strike === 4) {
        const reward = 3000; // baseball.js의 REWARD와 일치시켜야 함
        db.prepare("UPDATE user SET money = money + ? WHERE user_id = ?").run(
          reward,
          message.author.id,
        );

        embed
          .setColor("#57f287")
          .setDescription(`**${content}** → 4S 정답!\n3000원 지급됐어요! 🎉`)
          .addFields({ name: "💰 보상", value: "+3,000원", inline: true });

        games.delete(message.author.id);
      }
      // 10번 다 썼을 때도 종료
      else if (game.tries >= game.maxTries) {
        embed
          .setColor("#ff4444")
          .setDescription(
            `10번 다 썼어요... 아쉽네요 ㅠㅠ\n정답은 **${game.answer.join("")}** 였습니다.`,
          )
          .addFields({ name: "결과", value: "게임 종료", inline: true });

        games.delete(message.author.id);
      }

      return message.reply({ embeds: [embed] });
    }
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
      strike++;
    } else if (answer.includes(guess[i])) {
      ball++;
    }
  }
  return { s: strike, b: ball };
}
