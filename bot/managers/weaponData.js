// 무기 강화 데이터: 생성비, 단계별 강화비·성공 확률, 경험치 규칙, 판매가, 단계 표시 도구.
// 강화는 시도마다 강화비를 내고, 성공하면 경험치(EXP)를 얻는다. 경험치가 그 단계의 필요량(EXP_NEED)을 넘으면 다음 단계로 올라가고(넘친 경험치는 없어진다),
// +5 이상에서는 실패하면 경험치가 EXP_LOSS만큼 깎인다 (단계는 내려가지 않는다).
// 필요 경험치는 1,000에서 시작해 단계마다 약 15%씩 커진다.
// 시도당 강화비와 판매가는 "한 단계를 올리는 데 드는 기대 비용(경험치를 모으는 시도 전체)"을 반영해 기대 환수율 94%가 되도록 계산했고,
// 모든 (단계, 경험치) 상태에서의 최적 전략까지 계산해서 어떤 전략으로도 기대 손익이 마이너스인 것을 확인했다.
const CREATE_COST = 10000;
const MAX_WEAPONS = 5; // 한 사람이 가질 수 있는 무기 수
const EXP_NEED = [1000, 1150, 1300, 1500, 1750, 2000, 2300, 2650, 3050, 3500]; // 단계별 필요 경험치 (+0→+1, +1→+2, …)
const EXP_GAIN = [350, 650]; // 성공 시 얻는 경험치 범위 (10 단위)
const EXP_LOSS = 200; // +5 이상에서 실패했을 때 깎이는 경험치
// [시도당 강화비, 성공 확률, 실패 시 경험치 감소 여부]
const STEPS = [
  [600, 0.9, false],
  [800, 0.85, false],
  [1100, 0.8, false],
  [1600, 0.72, false],
  [2100, 0.65, false],
  [2800, 0.55, true],
  [3500, 0.5, true],
  [4400, 0.45, true],
  [5400, 0.4, true],
  [5700, 0.35, true],
];
const SELL_PRICE = [
  7000, 8200, 10400, 14100, 21000, 32700, 61400, 110200, 199000, 368300, 684700,
];
// 단계별 등급 이름 (무기 이름과 별개로, 지금 단계가 어느 수준인지 보여 준다)
const TIER_NAMES = [
  "나무 막대",
  "녹슨 검",
  "철검",
  "강철검",
  "미스릴 검",
  "다마스커스 검",
  "룬 검",
  "용린 검",
  "성검",
  "마검",
  "신검",
];
const MAX_LEVEL = STEPS.length;

/** 그 단계에서 다음 단계로 올라가는 데 필요한 경험치 (최고 단계는 0) */
const expNeed = (level) => EXP_NEED[level] ?? 0;
/** 성공했을 때 얻는 경험치: EXP_GAIN 범위의 10 단위 값 */
const rollGain = (randomInt) =>
  randomInt(EXP_GAIN[0] / 10, EXP_GAIN[1] / 10 + 1) * 10;

/** 단계 막대: 올라온 단계는 🟦, 남은 단계는 ⬜ (예: +3 → 🟦🟦🟦⬜⬜⬜⬜⬜⬜⬜) */
const levelBar = (level) => "🟦".repeat(level) + "⬜".repeat(MAX_LEVEL - level);
/** 경험치 막대 (10칸, 🟩) */
const expBar = (exp, level) => {
  const need = expNeed(level) || 1;
  const filled = Math.min(10, Math.floor((exp / need) * 10));
  return "🟩".repeat(filled) + "⬜".repeat(10 - filled);
};
const expText = (exp, level) =>
  `${Math.floor((exp / (expNeed(level) || 1)) * 100)}% (${exp.toLocaleString()}/${expNeed(level).toLocaleString()} EXP)`;

/** 무기 이름 확인: 한글·영문·숫자·공백만, 1~12글자. 멘션·링크·서식 문자는 막는다. 통과하면 다듬은 이름, 아니면 null */
function cleanName(raw) {
  const name = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return /^[가-힣a-zA-Z0-9 ]{1,12}$/.test(name) ? name : null;
}

module.exports = {
  CREATE_COST,
  MAX_WEAPONS,
  EXP_NEED,
  EXP_GAIN,
  EXP_LOSS,
  STEPS,
  SELL_PRICE,
  TIER_NAMES,
  MAX_LEVEL,
  expNeed,
  rollGain,
  levelBar,
  expBar,
  expText,
  cleanName,
};
