const db = require("../../../Database");
const { MessageFlags } = require("discord.js");

/**
 * 유저 조회 + 잔액 체크 유틸 함수
 * 대부분의 돈 관련 명령어에서 공통으로 사용됨
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {number} requiredAmount 필요한 최소 금액 (0이면 체크 안 함)
 * @throws {Error} NOT_REGISTERED 또는 INSUFFICIENT_MONEY
 */
function getUserOrFail(interaction, requiredAmount = 0) {
  const userId = interaction.user.id;

  const user = db.prepare("SELECT * FROM user WHERE user_id = ?").get(userId);

  if (!user) {
    throw new Error("NOT_REGISTERED"); // 가입 안 된 경우
  }

  if (requiredAmount > 0 && user.money < requiredAmount) {
    throw new Error("INSUFFICIENT_MONEY"); // 돈 부족한 경우
  }

  return user;
}

module.exports = {
  getUserOrFail,
};
