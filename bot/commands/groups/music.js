const { makeGroup } = require("../../commandGroup");

// /음악 — 재생과 대기열, 추천을 한곳에
module.exports = makeGroup({
  name: "음악",
  description: "음성 채널에서 음악 재생 (대기열·반복·볼륨·추천)",
  entries: [
    {
      module: require("../music/music"),
      flatten: {
        재생: "재생",
        일시정지: "일시정지",
        스킵: "스킵",
        정지: "정지",
        대기열: "큐",
        섞기: "섞기",
        반복: "반복",
        볼륨: "볼륨",
      },
    },
    {
      module: require("../music/music_recommend"),
      flatten: {
        추천받기: "받기",
        추천차트: "차트",
        상태: "상태",
        추천알림설정: "자동",
        추천사이트추가: "사이트추가",
        추천사이트삭제: "사이트삭제",
      },
    },
  ],
});
