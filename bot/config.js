// 기능 스위치와 공통 설정 (.env로 바꾼다)
// index.js·deploy-commands.js가 dotenv를 먼저 읽은 뒤에 불러와야 한다
module.exports = {
  // 공식 웹사이트 주소. 이용약관·개인정보 처리방침 링크(이메일 등록 동의 안내, 도움말 버튼)에 쓴다.
  // 사이트를 다른 주소로 게시하면 .env의 SITE_URL만 바꾸면 된다 (끝의 /는 없어도 된다)
  SITE_URL: (
    process.env.SITE_URL || "https://felnut.github.io/OMNI-Bot"
  ).replace(/\/+$/, ""),

  // 아래는 기능 스위치 (기본값은 꺼짐)
  // 서버별 이용 기록(user_guild) 저장과 '현재 서버' 랭킹.
  // 개인정보 처리방침 개정본(2026-10-26 시행)에 이 항목이 반영되기 전까지는 꺼 둔다. 켜려면 GUILD_RANK_ENABLED=1
  GUILD_RANK_ENABLED: process.env.GUILD_RANK_ENABLED === "1",
};
