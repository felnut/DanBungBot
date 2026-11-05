// 퀘스트·도전과제·배지의 기록과 보상 처리.
// 게임·출석 같은 명령어가 성공하면 record(userId, 이벤트)를 불러 진행도를 쌓고,
// 화면(/퀘스트, /도전과제, /배지, /프로필)은 여기서 계산한 값을 보여 준다.
const crypto = require("node:crypto");
const db = require("../../Database");
const cache = require("../commands/utils/cache");
const { FISH } = require("./fishData");

// ================== 퀘스트 ==================
// event: record()로 올라오는 이벤트 이름. 보상은 출석(약 250원)에 견주어 작게 잡았다.
const DAILY_FIXED = {
  id: "d_attend",
  text: "출석하기",
  event: "attend",
  target: 1,
  reward: 200,
};
const DAILY_POOL = [
  {
    id: "d_play",
    text: "미니게임 5판 하기",
    event: "play",
    target: 5,
    reward: 300,
  },
  {
    id: "d_fish",
    text: "낚시 3번 하기",
    event: "fish",
    target: 3,
    reward: 250,
  },
  { id: "d_lotto", text: "복권 긁기", event: "lotto", target: 1, reward: 150 },
  {
    id: "d_stock",
    text: "주식 거래 1번 하기",
    event: "stock",
    target: 1,
    reward: 250,
  },
  {
    id: "d_weapon",
    text: "무기 강화 2번 하기",
    event: "weapon",
    target: 2,
    reward: 250,
  },
];
const WEEKLY_POOL = [
  {
    id: "w_play",
    text: "미니게임 30판 하기",
    event: "play",
    target: 30,
    reward: 1200,
  },
  {
    id: "w_fish",
    text: "낚시 15번 하기",
    event: "fish",
    target: 15,
    reward: 1000,
  },
  {
    id: "w_stock",
    text: "주식 거래 5번 하기",
    event: "stock",
    target: 5,
    reward: 1000,
  },
  {
    id: "w_weapon",
    text: "무기 강화 10번 하기",
    event: "weapon",
    target: 10,
    reward: 1000,
  },
  {
    id: "w_attend",
    text: "출석 5일 하기",
    event: "attend",
    target: 5,
    reward: 1200,
  },
];
const MONTHLY = [
  {
    id: "m_attend",
    text: "출석 20일 하기",
    event: "attend",
    target: 20,
    reward: 5000,
  },
  {
    id: "m_play",
    text: "미니게임 150판 하기",
    event: "play",
    target: 150,
    reward: 4000,
  },
];
const DAILY_EXTRA = 2;
const WEEKLY_COUNT = 2;
const QUEST_KEEP_DAYS = 60;

const DAY_MS = 86400e3;
const kst = (now = Date.now()) => new Date(now + 9 * 3600e3);
const iso = (d) => d.toISOString().slice(0, 10);

/** 지금 기준 일일·주간·월간 기간 키 (KST, 주는 월요일 시작) */
function periodKeys(now = Date.now()) {
  const k = kst(now);
  const monday = new Date(k.getTime() - ((k.getUTCDay() + 6) % 7) * DAY_MS);
  return {
    daily: `d:${iso(k)}`,
    weekly: `w:${iso(monday)}`,
    monthly: `m:${iso(k).slice(0, 7)}`,
  };
}

/** 기간 키로 순서를 섞어서(모든 사람이 같은 날 같은 퀘스트) 앞에서 n개를 고른다 */
function pickSeeded(pool, seed, n) {
  const score = (q) =>
    crypto
      .createHash("sha256")
      .update(`${seed}:${q.id}`)
      .digest()
      .readUInt32BE(0);
  return [...pool].sort((a, b) => score(a) - score(b)).slice(0, n);
}

/** 지금 진행 중인 퀘스트 목록 [{...퀘스트, tier, period}] */
function currentQuests(now = Date.now()) {
  const p = periodKeys(now);
  return [
    ...[DAILY_FIXED, ...pickSeeded(DAILY_POOL, p.daily, DAILY_EXTRA)].map(
      (q) => ({ ...q, tier: "일일", period: p.daily }),
    ),
    ...pickSeeded(WEEKLY_POOL, p.weekly, WEEKLY_COUNT).map((q) => ({
      ...q,
      tier: "주간",
      period: p.weekly,
    })),
    ...MONTHLY.map((q) => ({ ...q, tier: "월간", period: p.monthly })),
  ];
}

// ================== 도전과제 ==================
// kind: stat(누적 기록) / money(보유 금액) / fishdex(낚시 도감 종류 수) / stockprofit(주식 실현 수익)
const ACHIEVEMENTS = [
  {
    id: "attend7",
    icon: "📅",
    name: "출석 새내기",
    desc: "출석 7일",
    kind: "stat",
    key: "attend",
    target: 7,
    reward: 300,
  },
  {
    id: "attend30",
    icon: "🗓️",
    name: "출석 단골",
    desc: "출석 30일",
    kind: "stat",
    key: "attend",
    target: 30,
    reward: 1000,
  },
  {
    id: "attend100",
    icon: "🏅",
    name: "출석왕",
    desc: "출석 100일",
    kind: "stat",
    key: "attend",
    target: 100,
    reward: 3000,
  },
  {
    id: "play50",
    icon: "🎮",
    name: "게임 입문",
    desc: "미니게임 50판",
    kind: "stat",
    key: "play",
    target: 50,
    reward: 500,
  },
  {
    id: "play300",
    icon: "🎯",
    name: "게임 마니아",
    desc: "미니게임 300판",
    kind: "stat",
    key: "play",
    target: 300,
    reward: 1500,
  },
  {
    id: "play1000",
    icon: "🏆",
    name: "게임 중독자",
    desc: "미니게임 1,000판",
    kind: "stat",
    key: "play",
    target: 1000,
    reward: 3000,
  },
  {
    id: "fish30",
    icon: "🎣",
    name: "초보 낚시꾼",
    desc: "낚시 30번",
    kind: "stat",
    key: "fish",
    target: 30,
    reward: 500,
  },
  {
    id: "fish200",
    icon: "🐟",
    name: "낚시 달인",
    desc: "낚시 200번",
    kind: "stat",
    key: "fish",
    target: 200,
    reward: 2000,
  },
  {
    id: "fishdex",
    icon: "📖",
    name: "도감 완성",
    desc: `낚시 도감 ${FISH.length}종 모두 수집`,
    kind: "fishdex",
    target: FISH.length,
    reward: 8000,
  },
  {
    id: "lotto50",
    icon: "🎫",
    name: "복권 애호가",
    desc: "복권 50장",
    kind: "stat",
    key: "lotto",
    target: 50,
    reward: 500,
  },
  {
    id: "stock20",
    icon: "📊",
    name: "개미 투자자",
    desc: "주식 거래 20번",
    kind: "stat",
    key: "stock",
    target: 20,
    reward: 700,
  },
  {
    id: "stockprofit",
    icon: "📈",
    name: "수익 실현",
    desc: "주식 실현 수익 10,000원",
    kind: "stockprofit",
    target: 10000,
    reward: 1500,
  },
  {
    id: "weapon5",
    icon: "⚔️",
    name: "대장장이 견습",
    desc: "무기 +5 달성",
    kind: "stat",
    key: "weapon_best",
    target: 5,
    reward: 700,
  },
  {
    id: "weapon8",
    icon: "🗡️",
    name: "숙련 대장장이",
    desc: "무기 +8 달성",
    kind: "stat",
    key: "weapon_best",
    target: 8,
    reward: 2000,
  },
  {
    id: "weapon10",
    icon: "🔱",
    name: "신검의 주인",
    desc: "무기 +10 달성",
    kind: "stat",
    key: "weapon_best",
    target: 10,
    reward: 5000,
  },
  {
    id: "transfer5",
    icon: "🤝",
    name: "나눔 실천",
    desc: "송금 5번",
    kind: "stat",
    key: "transfer",
    target: 5,
    reward: 300,
  },
  {
    id: "money10k",
    icon: "💰",
    name: "만원의 행복",
    desc: "보유 금액 10,000원",
    kind: "money",
    target: 10000,
    reward: 500,
  },
  {
    id: "money100k",
    icon: "💎",
    name: "부자",
    desc: "보유 금액 100,000원",
    kind: "money",
    target: 100000,
    reward: 2000,
  },
];
const ACH_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

// ================== 기록 ==================
const stmtExists = db.prepare("SELECT 1 FROM user WHERE user_id = ?");
const stmtStatAdd = db.prepare(
  "INSERT INTO stat (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = value + excluded.value",
);
const stmtStatMax = db.prepare(
  "INSERT INTO stat (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = MAX(value, excluded.value)",
);
const stmtQuestAdd = db.prepare(
  `INSERT INTO quest_progress (user_id, period_key, quest_id, progress) VALUES (?, ?, ?, ?)
   ON CONFLICT(user_id, period_key, quest_id) DO UPDATE SET progress = progress + excluded.progress`,
);

// 비용 없이 반복할 수 있는 행동(수수료 없는 주식 사고팔기, 내 다른 계정에 송금)은 하루에 세는 횟수를 제한한다.
// 횟수는 오늘 날짜 퀘스트 기록(quest_id = cap_이벤트)에 함께 쌓이고, 오래된 퀘스트 정리 때 같이 지워진다.
const DAILY_CAPS = { stock: 4, transfer: 3 };
const stmtCapGet = db.prepare(
  "SELECT progress FROM quest_progress WHERE user_id = ? AND period_key = ? AND quest_id = ?",
);

/** 성공한 행동을 기록한다. 가입하지 않았으면 무시. 기록 때문에 본래 명령어가 실패하면 안 되므로 오류는 삼킨다 */
function record(userId, event, n = 1) {
  try {
    if (!stmtExists.get(userId)) return;
    db.transaction(() => {
      const cap = DAILY_CAPS[event];
      if (cap) {
        const capId = `cap_${event}`;
        const day = periodKeys().daily;
        if ((stmtCapGet.get(userId, day, capId)?.progress ?? 0) >= cap) return;
        stmtQuestAdd.run(userId, day, capId, 1);
      }
      stmtStatAdd.run(userId, event, n);
      for (const q of currentQuests())
        if (q.event === event) stmtQuestAdd.run(userId, q.period, q.id, n);
    })();
  } catch (e) {
    console.error("진행도 기록 실패:", e?.message ?? e);
  }
}

/** 기록 중 '가장 높은 값'을 남긴다 (예: 무기 최고 단계) */
function recordMax(userId, key, value) {
  try {
    if (stmtExists.get(userId)) stmtStatMax.run(userId, key, value);
  } catch (e) {
    console.error("진행도 기록 실패:", e?.message ?? e);
  }
}

// ================== 퀘스트 화면·보상 ==================
const stmtQuestRows = db.prepare(
  "SELECT period_key, quest_id, progress, claimed FROM quest_progress WHERE user_id = ?",
);

function questView(userId) {
  const rows = new Map(
    stmtQuestRows.all(userId).map((r) => [`${r.period_key}|${r.quest_id}`, r]),
  );
  return currentQuests().map((q) => {
    const r = rows.get(`${q.period}|${q.id}`);
    const progress = Math.min(r?.progress ?? 0, q.target);
    return {
      ...q,
      progress,
      done: progress >= q.target,
      claimed: Boolean(r?.claimed),
    };
  });
}

const stmtQuestClaim = db.prepare(
  `INSERT INTO quest_progress (user_id, period_key, quest_id, progress, claimed) VALUES (?, ?, ?, 0, 1)
   ON CONFLICT(user_id, period_key, quest_id) DO UPDATE SET claimed = 1 WHERE claimed = 0 AND progress >= ?`,
);
const stmtMoneyAdd = db.prepare(
  "UPDATE user SET money = money + ? WHERE user_id = ?",
);

/** 완료했고 아직 받지 않은 퀘스트 보상을 한꺼번에 받는다. 반환: { count, total } (받을 게 없으면 count 0) */
const claimQuests = db.transaction((userId) => {
  let count = 0;
  let total = 0;
  for (const q of questView(userId)) {
    if (!q.done || q.claimed) continue;
    // 조건(claimed = 0 AND progress >= 목표)을 만족할 때만 갱신되므로 같은 보상은 두 번 받을 수 없다
    if (stmtQuestClaim.run(userId, q.period, q.id, q.target).changes) {
      count += 1;
      total += q.reward;
    }
  }
  if (total) stmtMoneyAdd.run(total, userId);
  return { count, total };
});

// ================== 도전과제 화면·보상 ==================
const stmtStats = db.prepare("SELECT key, value FROM stat WHERE user_id = ?");
const stmtMoneyOf = db.prepare("SELECT money FROM user WHERE user_id = ?");
const stmtFishKinds = db.prepare(
  "SELECT COUNT(*) AS n FROM fish_log WHERE user_id = ? AND count > 0",
);
const stmtRealized = db.prepare(
  "SELECT profit FROM stock_realized WHERE user_id = ?",
);
const stmtClaimedAch = db.prepare(
  "SELECT id FROM achievement WHERE user_id = ?",
);

function currentValue(a, userId, stats) {
  switch (a.kind) {
    case "stat":
      return stats.get(a.key) ?? 0;
    case "money":
      return stmtMoneyOf.get(userId)?.money ?? 0;
    case "fishdex":
      return stmtFishKinds.get(userId).n;
    case "stockprofit":
      return stmtRealized.get(userId)?.profit ?? 0;
    default:
      return 0;
  }
}

function achievementView(userId) {
  const stats = new Map(stmtStats.all(userId).map((r) => [r.key, r.value]));
  const claimed = new Set(stmtClaimedAch.all(userId).map((r) => r.id));
  return ACHIEVEMENTS.map((a) => {
    const value = Math.max(currentValue(a, userId, stats), 0);
    return {
      ...a,
      value: Math.min(value, a.target),
      done: value >= a.target,
      claimed: claimed.has(a.id),
    };
  });
}

const stmtAchClaim = db.prepare(
  "INSERT OR IGNORE INTO achievement (user_id, id, claimed_at) VALUES (?, ?, ?)",
);

/** 달성했고 아직 받지 않은 도전과제 보상을 한꺼번에 받는다. 반환: { items: [이름], total } */
const claimAchievements = db.transaction((userId) => {
  const items = [];
  let total = 0;
  for (const a of achievementView(userId)) {
    if (!a.done || a.claimed) continue;
    if (stmtAchClaim.run(userId, a.id, Date.now()).changes) {
      items.push(`${a.icon} ${a.name}`);
      total += a.reward;
    }
  }
  if (total) stmtMoneyAdd.run(total, userId);
  return { items, total };
});

// ================== 배지 ==================
/** 보상을 받은 도전과제의 배지 목록 */
function badgesOf(userId) {
  const ids = new Set(stmtClaimedAch.all(userId).map((r) => r.id));
  return ACHIEVEMENTS.filter((a) => ids.has(a.id));
}

const stmtEquipped = db.prepare("SELECT badge FROM user WHERE user_id = ?");
const stmtEquip = db.prepare("UPDATE user SET badge = ? WHERE user_id = ?");

/** 장착 중인 배지(도전과제 정의) 또는 null. 가진 적 없는 배지가 남아 있으면 무시 */
function equippedBadge(userId) {
  const id = stmtEquipped.get(userId)?.badge;
  if (!id) return null;
  return badgesOf(userId).find((a) => a.id === id) ?? null;
}

/** 배지 장착(id) 또는 해제(null). 가진 배지만 장착할 수 있다 */
function equipBadge(userId, id) {
  if (id !== null && !badgesOf(userId).some((a) => a.id === id)) return false;
  stmtEquip.run(id, userId);
  return true;
}

/** 오래된 퀘스트 기록 정리 (정기 정리에서 호출) */
function purgeOldQuests(now = Date.now()) {
  const cutoff = iso(new Date(kst(now).getTime() - QUEST_KEEP_DAYS * DAY_MS));
  // d:2026-10-21 / w:2026-10-19 / m:2026-10 모두 날짜 문자열 비교로 오래됨을 판단할 수 있다
  return db
    .prepare("DELETE FROM quest_progress WHERE substr(period_key, 3) < ?")
    .run(cutoff.slice(0, 10)).changes;
}

const invalidateMoney = (userId) => cache.invalidateMoney(userId);

module.exports = {
  ACHIEVEMENTS,
  ACH_BY_ID,
  currentQuests,
  record,
  recordMax,
  questView,
  claimQuests,
  achievementView,
  claimAchievements,
  badgesOf,
  equippedBadge,
  equipBadge,
  purgeOldQuests,
  invalidateMoney,
};
