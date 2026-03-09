const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const { getUserOrFail } = require("../utils/user");
const db = require("../../../Database");
const { games } = require("../utils/gameState");

const BET_AMOUNT = 1000;
const REWARD = BET_AMOUNT * 3;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("숫자야구")
    .setDescription("숫자 야구 (베팅 1000원)")
    .addSubcommand((sub) => sub.setName("시작").setDescription("게임 시작"))
    .addSubcommand((sub) =>
      sub.setName("포기").setDescription("포기하고 정답 보기"),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // 시작
    if (sub === "시작") {
      let user;
      try {
        user = getUserOrFail(interaction, BET_AMOUNT);
      } catch (err) {
        if (err.message === "NOT_REGISTERED") {
          return interaction.reply({
            content: "등록되지 않았습니다. `/돈`으로 가입해주세요.",
            flags: MessageFlags.Ephemeral,
          });
        }
        if (err.message === "INSUFFICIENT_MONEY") {
          return interaction.reply({
            content: `보유금이 부족합니다.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        throw err;
      }

      if (games.has(interaction.user.id)) {
        return interaction.reply({
          content: "이미 게임 중입니다. `/숫자야구 포기`를 입력하세요.",
          flags: MessageFlags.Ephemeral,
        });
      }

      db.prepare("UPDATE user SET money = money - ? WHERE user_id = ?").run(
        BET_AMOUNT,
        interaction.user.id,
      );

      const answer = generateAnswer();
      games.set(interaction.user.id, {
        answer,
        tries: 0,
        maxTries: 10,
        history: [],
      });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("#00cc99")
            .setTitle("⚾ 숫자 야구 시작!")
            .setDescription(
              "룰\n\n" +
                "- **1~9 서로 다른 4자리 숫자**를 입력해서 맞춰보세요.\n" +
                "- 숫자 + 위치 모두 맞음 → **S (스트라이크)**\n" +
                "- 숫자만 맞음 → **B (볼)**\n" +
                "예) 정답 4821 일 때\n" +
                "   1234 → 1S 1B\n" +
                "   8421 → 2S 2B\n" +
                "   4821 → 4S (정답!)\n\n" +
                `**${BET_AMOUNT}원** 베팅 (이기면 ${REWARD}원)\n` +
                "기회 총 **10번**\n\n" +
                "채팅에 **4자리 숫자** 입력하면 게임이 진행됩니다.\n" +
                "(예: 4821 입력 → 바로 결과 나옴)\n" +
                "포기하고 싶으면 `/숫자야구 포기`를 입력하세요",
            )
            .setFooter({ text: "0, 중복 숫자는 안됩니다!" }),
        ],
      });
    }

    // 포기
    if (sub === "포기") {
      const game = games.get(interaction.user.id);
      if (!game) {
        return interaction.reply({
          content: "진행 중인 게임이 없습니다.",
          flags: MessageFlags.Ephemeral,
        });
      }

      games.delete(interaction.user.id);
      return interaction.reply(
        `포기! 정답은 **${game.answer.join("")}**였습니다.\n1000원 손실`,
      );
    }
  },
};

// 헬퍼 함수
function generateAnswer() {
  const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const result = [];
  while (result.length < 4) {
    const idx = Math.floor(Math.random() * numbers.length);
    result.push(numbers[idx]);
    numbers.splice(idx, 1);
  }
  return result;
}
