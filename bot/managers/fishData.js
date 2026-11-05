// 낚시 데이터: 어종, 낚싯대별 확률표, 미끼 종류. 확률표는 낚싯대마다 합이 TOTAL(1,000,000)이고, 잡았을 때 기준 기대 환수율이 94%다.
// (입질을 놓치거나 줄 당기기에 실패해 물고기가 도망가면 미끼만 잃으므로 실제 환수율은 이보다 낮다)
// (낚싯대가 좋아져도 환수율은 그대로 — 새 어종이 나타나고 대신 기존 희귀종 확률이 조금 줄어든다)
// size: 몸길이 범위(cm, 크기 기록용이며 판매가에는 영향이 없다), emoji: 결과 화면에 크게 보여 줄 이모지 이미지의 코드
const FISH = [
  {
    key: "boot",
    name: "👢 낡은 장화",
    mult: 0,
    rod: 0,
    size: [20, 32],
    emoji: "1f462",
    line: "물고기인 줄 알았는데 장화였다… 누가 여기에 버렸을까?",
  },
  {
    key: "crucian",
    name: "🐟 붕어",
    mult: 0.4,
    rod: 0,
    size: [10, 35],
    emoji: "1f41f",
    line: "붕어를 잡았다! 흔하지만 든든한 낚시터의 단골손님.",
  },
  {
    key: "carp",
    name: "🐠 잉어",
    mult: 0.9,
    rod: 0,
    size: [20, 80],
    emoji: "1f420",
    line: "잉어를 잡았다! 힘이 어찌나 센지 팔이 얼얼하다.",
  },
  {
    key: "bass",
    name: "🐡 농어",
    mult: 1.5,
    rod: 0,
    size: [25, 90],
    emoji: "1f421",
    line: "농어를 잡았다! 통통하게 부풀어 오른 모습이 귀엽다.",
  },
  {
    key: "salmon",
    name: "🍣 연어",
    mult: 3,
    rod: 0,
    size: [40, 100],
    emoji: "1f363",
    line: "연어를 잡았다! 먼 바다에서 돌아온 모양이다.",
  },
  {
    key: "tuna",
    name: "🦈 참치",
    mult: 6,
    rod: 0,
    size: [80, 250],
    emoji: "1f988",
    line: "참치를 잡았다! 낚싯대가 부러질 뻔했다!",
  },
  {
    key: "gold",
    name: "👑 황금물고기",
    mult: 20,
    rod: 0,
    size: [15, 40],
    emoji: "1f451",
    line: "황금물고기를 잡았다! 반짝반짝 빛나는 행운의 상징!",
  },
  {
    key: "squid",
    name: "🦑 오징어",
    mult: 2,
    rod: 1,
    size: [15, 50],
    emoji: "1f991",
    line: "오징어를 잡았다! 먹물을 조심하자.",
  },
  {
    key: "crab",
    name: "🦀 꽃게",
    mult: 5,
    rod: 2,
    size: [8, 25],
    emoji: "1f980",
    line: "꽃게를 잡았다! 집게발이 낚싯줄을 꽉 물고 있다.",
  },
  {
    key: "octopus",
    name: "🐙 문어",
    mult: 8,
    rod: 3,
    size: [30, 100],
    emoji: "1f419",
    line: "문어를 잡았다! 다리가 여덟 개라 끌어올리기 힘들었다.",
  },
  {
    key: "lobster",
    name: "🦞 랍스터",
    mult: 12,
    rod: 4,
    size: [20, 50],
    emoji: "1f99e",
    line: "랍스터를 잡았다! 오늘 저녁은 호화로운 만찬이다.",
  },
  {
    key: "dolphin",
    name: "🐬 돌고래",
    mult: 25,
    rod: 5,
    size: [150, 300],
    emoji: "1f42c",
    line: "돌고래를 잡았다! 똑똑한 친구가 인사하러 왔나 보다.",
  },
  {
    key: "whale",
    name: "🐋 고래",
    mult: 40,
    rod: 5,
    size: [500, 2000],
    emoji: "1f40b",
    line: "고래를 잡았다! 바다가 들썩이는 엄청난 손맛이다!",
  },
  {
    key: "mermaid",
    name: "🧜 인어",
    mult: 100,
    rod: 6,
    size: [120, 180],
    emoji: "1f9dc",
    line: "인어를 잡았다! 전설이 사실이었다니…",
  },
];
const BY_KEY = new Map(FISH.map((f) => [f.key, f]));

/** 크기 등급: 그 어종의 범위에서 어디쯤인지 */
function sizeClass(fish, cm) {
  const [min, max] = fish.size;
  const ratio = (cm - min) / (max - min);
  return ratio < 0.25
    ? "소형"
    : ratio < 0.6
      ? "중형"
      : ratio < 0.9
        ? "대형"
        : "특대";
}
/** 어종 범위 안에서 크기(cm, 소수 첫째 자리)를 뽑는다. 두 번 뽑아 평균을 내서 중간 크기가 더 자주 나온다 */
function rollSize(fish, rand = Math.random) {
  const [min, max] = fish.size;
  const cm = min + ((rand() + rand()) / 2) * (max - min);
  return Math.round(cm * 10) / 10;
}
/** 결과 화면에 크게 보여 줄 어종 이미지 주소 (트위터 이모지 이미지) */
const fishImage = (fish) =>
  `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${fish.emoji}.png`;

// 낚싯대 단계별 확률(가중치). 인덱스 = 낚싯대 단계
const WEIGHTS = [
  {
    boot: 250000,
    crucian: 306000,
    carp: 214000,
    bass: 140000,
    salmon: 65000,
    tuna: 20000,
    gold: 5000,
  },
  {
    boot: 250000,
    crucian: 249800,
    carp: 261200,
    bass: 110000,
    salmon: 50000,
    tuna: 15000,
    gold: 4000,
    squid: 60000,
  },
  {
    boot: 250000,
    crucian: 422500,
    carp: 80000,
    bass: 100000,
    salmon: 45000,
    tuna: 14000,
    gold: 3500,
    squid: 55000,
    crab: 30000,
  },
  {
    boot: 250000,
    crucian: 500000,
    carp: 20000,
    bass: 90000,
    salmon: 40000,
    tuna: 12000,
    gold: 3000,
    squid: 45000,
    crab: 25000,
    octopus: 15000,
  },
  {
    boot: 250000,
    crucian: 482500,
    carp: 60000,
    bass: 80000,
    salmon: 35000,
    tuna: 10000,
    gold: 2500,
    squid: 40000,
    crab: 22000,
    octopus: 12000,
    lobster: 6000,
  },
  {
    boot: 250000,
    crucian: 447460,
    carp: 137240,
    bass: 62000,
    salmon: 27000,
    tuna: 7500,
    gold: 1800,
    squid: 32000,
    crab: 18000,
    octopus: 9000,
    lobster: 4500,
    dolphin: 2500,
    whale: 1000,
  },
  {
    boot: 250000,
    crucian: 533280,
    carp: 41320,
    bass: 70000,
    salmon: 30000,
    tuna: 8000,
    gold: 2000,
    squid: 30000,
    crab: 18000,
    octopus: 9000,
    lobster: 4500,
    dolphin: 2500,
    whale: 1200,
    mermaid: 200,
  },
];
/** 낚싯대 단계의 pickWeighted용 표 [{...어종, weight}] */
const tableFor = (rod) =>
  Object.entries(WEIGHTS[rod]).map(([key, weight]) => ({
    ...BY_KEY.get(key),
    weight,
  }));

// bite: 입질 대기 시간 배율 (작을수록 입질이 빨리 온다)
const RODS = [
  { name: "맨손", price: 0, bite: 1 },
  { name: "대나무 낚싯대", price: 5000, bite: 0.85 },
  { name: "유리섬유 낚싯대", price: 20000, bite: 0.72 },
  { name: "탄소 낚싯대", price: 60000, bite: 0.6 },
  { name: "티타늄 낚싯대", price: 150000, bite: 0.5 },
  { name: "미스릴 낚싯대", price: 400000, bite: 0.4 },
  { name: "용골 낚싯대", price: 1000000, bite: 0.3 },
];

// 미끼 한 개 가격 = 한 번 던질 때의 판돈. 잡은 물고기는 가격 × 배율에 바로 팔린다
const BAITS = [
  { key: "basic", name: "일반 미끼", price: 100 },
  { key: "premium", name: "고급 미끼", price: 1000 },
  { key: "deluxe", name: "최고급 미끼", price: 10000 },
];
const BAIT_BY_KEY = new Map(BAITS.map((b) => [b.key, b]));
const MAX_BAIT_PER_KIND = 500;
const DEX_BONUS_MULT = 3; // 도감 첫 등록 보너스 = 쓴 미끼값 × 이 배수 (어종마다 한 번뿐)

module.exports = {
  FISH,
  BY_KEY,
  WEIGHTS,
  tableFor,
  sizeClass,
  rollSize,
  fishImage,
  RODS,
  BAITS,
  BAIT_BY_KEY,
  MAX_BAIT_PER_KIND,
  DEX_BONUS_MULT,
};
