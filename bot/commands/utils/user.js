const db = require("../../../Database");
const { MessageFlags } = require("discord.js");

/**
 * 유저 조회 + 잔액 체크
 * → DB에 없으면 "먼저 /돈 명령어로 가입하세요" 메시지 띄우고 null 반환
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {number} requiredAmount 필요한 최소 금액 (0이면 잔액 체크 안 함)
 * @returns {Object|null} user 객체 또는 null
 */
function getUserOrFail(interaction, requiredAmount = 0) {
  const userId = interaction.user.id;

  const user = db.prepare("SELECT * FROM user WHERE user_id = ?").get(userId);

  if (!user) {  //등록 안됨
    throw new Error("NOT_REGISTERED");
  }

  if (requiredAmount > 0 && user.money < requiredAmount) {  //돈 부족
    throw new Error("INSUFFICIENT_MONEY");
  }

  return user;
}

module.exports = {
  getUserOrFail,
};
