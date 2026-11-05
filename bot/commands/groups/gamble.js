const { makeGroup } = require("../../commandGroup");
const g = (file) => require(`../game/${file}`);

// /도박 — 돈을 거는 게임 모음
module.exports = makeGroup({
  name: "도박",
  description:
    "돈을 걸고 하는 게임 (블랙잭·룰렛·홀짝·가위바위보·동물경주·슬롯·카드뽑기·숫자야구)",
  entries: [
    { name: "블랙잭", module: g("blackjack") },
    { name: "룰렛", module: g("roulette") },
    { name: "홀짝", module: g("even_odd") },
    { name: "가위바위보", module: g("rps") },
    { name: "동물경주", module: g("race") },
    { name: "슬롯", module: g("slot") },
    { name: "카드뽑기", module: g("card_draw") },
    { name: "숫자야구", module: g("baseball") },
  ],
});
