const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const { getUserOrFail } = require("../utils/user");
const db = require("../../../Database");
const { games } = require("../utils/gameState");

/** 게임 설정값 */
const BET_AMOUNT = 1000; // 베팅 금액
const REWARD = BET_AMOUNT * 3; // 승리 시 받는 보상 (3000원)

// 헬퍼 함수: 1~9 중복 없는 4자리 정답 생성
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

    // ==================== 게임 시작 ====================
    if (sub === "시작") {
      let user;
      try {
        user = getUserOrFail(interaction, BET_AMOUNT); // 돈 있는지 체크
      } catch (err) {
        if (err.message === "NOT_REGISTERED") {
          return interaction.reply({
            content: "등록되지 않았습니다. `/돈`으로 가입해주세요.",
            flags: MessageFlags.Ephemeral,
          });
        }
        if (err.message === "INSUFFICIENT_MONEY") {
          return interaction.reply({
            content: "보유금이 부족합니다.",
            flags: MessageFlags.Ephemeral,
          });
        }
        throw err;
      }

      // 이미 게임 중인지 체크
      if (games.has(interaction.user.id)) {
        return interaction.reply({
          content: "이미 게임 중입니다. `/숫자야구 포기`를 입력하세요.",
          flags: MessageFlags.Ephemeral,
        });
      }

      // 베팅 차감
      db.prepare("UPDATE user SET money = money - ? WHERE user_id = ?").run(
        BET_AMOUNT,
        interaction.user.id,
      );

      // 정답 생성하고 게임 상태 저장
      const answer = generateAnswer();
      games.set(interaction.user.id, {
        answer,
        tries: 0,
        maxTries: 10,
        history: [],
      });

      // 게임 시작 안내 임베드
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("#00cc99")
            .setTitle("⚾ 숫자 야구 시작!")
            .setDescription(
              "1~9 서로 다른 **4자리 숫자**를 입력해서 맞춰보세요!\n\n" +
                "✅ **S** = 숫자, 위치 모두 맞음\n" +
                "✅ **B** = 숫자만 맞음\n\n" +
                "예시:\n" +
                "정답 4821일 때\n" +
                "1234 → **1S 1B**\n" +
                "8421 → **2S 2B**\n" +
                "4821 → **4S 정답!**\n\n" +
                `💰 **${BET_AMOUNT}원** 베팅 → 이기면 **${REWARD}원**\n` +
                "기회는 총 **10번**\n\n" +
                "채팅에 **4자리 숫자**만 입력하면 바로 결과 나와요!\n" +
                "포기하고 싶으면 `/숫자야구 포기`를 입력하세요!",
            )
            .setFooter({ text: "**0**이나 **중복 숫자**는 안 돼요!" }),
        ],
      });
    }

    // ==================== 게임 포기 ====================
    if (sub === "포기") {
      const game = games.get(interaction.user.id);

      if (!game) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor("#ff4444")
              .setTitle("❔ 진행 중인 게임이 없어요")
              .setDescription("`/숫자야구 시작`으로 먼저 게임을 시작해주세요!"),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      games.delete(interaction.user.id); // 게임 상태 삭제

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("#ff4444")
            .setTitle("😢 포기하셨네요...")
            .setDescription(
              `정답은 **${game.answer.join("")}**였습니다.\n` +
                `1000원 손실... 다음엔 꼭 이겨보자! 🔥`,
            ),
        ],
      });
    }
  },
};
