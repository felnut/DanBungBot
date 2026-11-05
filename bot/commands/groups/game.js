const { makeGroup } = require("../../commandGroup");
const g = (file) => require(`../game/${file}`);

// /게임 — 가입·출석·송금·랭킹·퀘스트 같은 계정과 성장
module.exports = makeGroup({
  name: "게임",
  description: "게임 계정 (가입·정보·출석·송금·퀘스트·도전과제·배지·랭킹)",
  entries: [
    {
      name: "가입",
      module: g("money"),
      description: "게임에 가입하고 내 지갑을 확인해요",
    },
    { name: "정보", module: g("profile") },
    { name: "출석", module: g("daily") },
    { name: "송금", module: g("transfer") },
    { name: "퀘스트", module: g("quest") },
    { name: "도전과제", module: g("achievement") },
    { name: "배지", module: g("badge") },
    { name: "랭킹", module: g("rank") },
  ],
});
