// 한 번에 끝나는 베팅 게임(가위바위보·동물경주·슬롯·낚시)이 함께 쓰는 정산 도구.
// 결과(배율)를 먼저 정한 뒤, 잔액 확인과 지급을 한 번의 트랜잭션으로 처리한다.
const crypto = require("node:crypto");
const { EmbedBuilder, MessageFlags } = require("discord.js");
const db = require("../../Database");
const cache = require("../commands/utils/cache");

const progress = require("./progress");

const MIN_BET = 10;
const TOTAL = 1_000_000;
// 퀘스트·도전과제로 세는 최소 베팅액 (아주 작은 판을 반복해 채우는 것을 막는다)
const PROGRESS_MIN_BET = 50;

/** 가중치(합이 TOTAL이 되도록 만든 비율) 표에서 하나를 뽑는다 */
function pickWeighted(table) {
  let n = crypto.randomInt(TOTAL);
  for (const row of table) {
    if (n < row.weight) return row;
    n -= row.weight;
  }
  return table[table.length - 1];
}

/** 표의 기대 환수율(배율 평균). 표를 바꿀 때 93~95%인지 확인하는 데 쓴다 */
const expectedReturn = (table) =>
  table.reduce((sum, r) => sum + (r.weight / TOTAL) * r.mult, 0);

const stmtUser = db.prepare("SELECT money FROM user WHERE user_id = ?");
const stmtMoney = db.prepare(
  "UPDATE user SET money = money + ? WHERE user_id = ?",
);

/** 잔액 확인 후 정산. 반환: { net, balance }. 가입 전이면 NOT_REGISTERED, 잔액 부족이면 INSUFFICIENT_MONEY */
const settle = db.transaction((userId, bet, mult) => {
  const user = stmtUser.get(userId);
  if (!user) throw new Error("NOT_REGISTERED");
  if (user.money < bet) throw new Error("INSUFFICIENT_MONEY");
  const net = Math.floor(bet * mult) - bet; // 소수점은 버려서 항상 봇에 유리하게
  stmtMoney.run(net, userId);
  cache.invalidateMoney(userId);
  return { net, balance: user.money + net };
});

const won = (net) =>
  `${net > 0 ? "+" : net < 0 ? "-" : ""}${Math.abs(net).toLocaleString()}원`;

/**
 * 한 판을 진행한다.
 * @param roll   () => ({ mult, ...결과 }) 결과를 정하는 함수
 * @param render (결과, { net, balance }) => { title, description } 화면에 보일 내용
 */
async function play(interaction, bet, roll, render) {
  const outcome = roll();
  let result;
  try {
    result = settle(interaction.user.id, bet, outcome.mult);
  } catch (err) {
    const content =
      err.message === "NOT_REGISTERED"
        ? "먼저 `/게임 가입`으로 가입해주세요!"
        : `💸 돈이 부족해요! (필요: ${bet.toLocaleString()}원)`;
    return interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
  if (bet >= PROGRESS_MIN_BET) progress.record(interaction.user.id, "play");
  const { title, description } = render(outcome, result);
  const embed = new EmbedBuilder()
    .setColor(result.net > 0 ? 0x57f287 : result.net < 0 ? 0xed4245 : 0xfee75c)
    .setTitle(title)
    .setDescription(
      `${description}\n\n💵 수익 **${won(result.net)}**\n💰 현재 잔액 **${result.balance.toLocaleString()}원**`,
    )
    .setTimestamp();
  return interaction.reply({ embeds: [embed] });
}

module.exports = {
  MIN_BET,
  PROGRESS_MIN_BET,
  TOTAL,
  pickWeighted,
  expectedReturn,
  play,
  won,
};
