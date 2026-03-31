// 숫자야구 게임처럼 여러 번 상호작용하는 게임의 상태를 저장하는 파일
// (유저 ID → 게임 정보 Map)

const games = new Map(); // 전역 게임 저장소 (메모리에만 보관)

module.exports = { games };
