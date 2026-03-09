const { EmbedBuilder } = require("discord.js");
const db = require("../../../../Database");
const { games } = require("../../utils/gameState");

module.exports = (client) => {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.inGuild()) return;

    const content = message.content.trim();

    if (!games.has(message.author.id)) return;

    if (/^[1-9]{4}$/.test(content) && new Set(content).size === 4) {
      const game = games.get(message.author.id);
      game.tries++;

      const guess = content.split("").map(Number);
      const { s, b } = checkGuess(guess, game.answer);

      // 히스토리에 이번 추측 저장
      game.history.push({
        guess: content,
        s,
        b,
      });

      // 정답!
      if (s === 4) {
        db.prepare("UPDATE user SET money = money + ? WHERE user_id = ?").run(
          3000,
          message.author.id,
        );
        games.delete(message.author.id);

        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor("#ffdd00")
              .setTitle("🎉 정답!")
              .setDescription(
                `**${content}** → ${s}S ${b}B\n` +
                  `${game.tries}번 만에 맞췄습니다!\n` +
                  `1000원 → 3000원 (+2000원 이득)`,
              ),
          ],
        });
      }

      // 기회 소진
      if (game.tries >= game.maxTries) {
        games.delete(message.author.id);
        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor("#ff4444")
              .setTitle("게임 오버")
              .setDescription(
                `정답: **${game.answer.join("")}**\n` +
                  `${game.tries}번 시도\n` +
                  "1000원 날아감...",
              ),
          ],
        });
      }

      // 일반 진행 상황
      const embed = new EmbedBuilder()
        .setColor("#88ddff")
        .setTitle(`추측 ${game.tries}회차`)
        .setDescription(`남은 기회: **${game.maxTries - game.tries}**번`);

      // 히스토리 전체 보여주기
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

      return message.reply({ embeds: [embed] });
    }
  });
};

function checkGuess(guess, answer) {
  let strike = 0;
  let ball = 0;
  for (let i = 0; i < 4; i++) {
    if (guess[i] === answer[i]) strike++;
    else if (answer.includes(guess[i])) ball++;
  }
  return { s: strike, b: ball };
}
