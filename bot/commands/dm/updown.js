const { SlashCommandBuilder, InteractionContextType } = require("discord.js");
const crypto = require("node:crypto");
const { runGuessGame } = require("../../managers/dmGuessGame");

const MAX_TRIES = 7;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("업다운")
    .setDescription("봇이 생각한 1~100 숫자를 7번 안에 맞혀 보세요 (DM 전용)")
    .setContexts(InteractionContextType.BotDM),

  async execute(interaction) {
    const answer = crypto.randomInt(1, 101);
    return runGuessGame(interaction, {
      title: "🔢 업다운",
      intro: `1부터 100 사이의 숫자를 하나 정했어요.\n**${MAX_TRIES}번** 안에 맞혀 보세요!`,
      maxTries: MAX_TRIES,
      inputLabel: "숫자 (1~100)",
      placeholder: "예: 50",
      maxLength: 3,
      judge(input) {
        if (
          !/^\d{1,3}$/.test(input) ||
          Number(input) < 1 ||
          Number(input) > 100
        )
          return {
            invalid:
              "1부터 100 사이의 숫자를 넣어 주세요. (기회는 줄지 않아요)",
          };
        const n = Number(input);
        if (n === answer) return { correct: true, text: "🎯 정답!" };
        return {
          correct: false,
          text: n < answer ? "🔼 더 커요 (UP)" : "🔽 더 작아요 (DOWN)",
        };
      },
      reveal: () => String(answer),
    });
  },
};
