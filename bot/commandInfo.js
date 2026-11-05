// 명령어 분류와 사용법 정리: /도움말과 웹사이트(scripts/build-site-data.js)가 함께 쓴다.
// 명령어 이름·설명·옵션은 각 명령어 파일의 정의(data)에서 읽으므로, 명령어를 추가하거나 바꾸면 자동으로 반영된다.

// 분류는 명령어 이름으로 묶는다. 목록에 없는 새 명령어는 "기타"에 들어간다.
const CATEGORIES = [
  {
    key: "game",
    emoji: "🎮",
    label: "게임·경제",
    color: "#E8590C",
    blurb: "출석하고 돈을 모아 도박·낚시·주식·무기 강화로 불려요",
    names: ["게임", "도박", "낚시", "복권", "주식", "무기"],
  },
  {
    key: "music",
    emoji: "🎵",
    label: "음악",
    color: "#7048E8",
    blurb: "음성 채널에서 재생하고, 차트와 추천곡을 받아요",
    names: ["음악"],
  },
  {
    key: "school",
    emoji: "🏫",
    label: "학교",
    color: "#1971C2",
    blurb: "급식·시간표·학사일정을 서버에서 바로 확인해요",
    names: ["학교"],
  },
  {
    key: "util",
    emoji: "🛠️",
    label: "편의",
    color: "#2F9E44",
    blurb: "계산·주사위·운세·추첨·디데이, 서버·유저 정보와 도움말",
    names: ["유틸"],
  },
  {
    key: "dm",
    emoji: "💌",
    label: "DM 전용",
    color: "#D6336C",
    blurb: "봇과의 1:1 대화(DM)에서만 쓰는 알림·메모·오락 명령어",
    names: ["알림", "메모", "타로", "업다운", "초성퀴즈"],
  },
  {
    key: "admin",
    emoji: "🛡️",
    label: "서버 운영",
    color: "#C92A2A",
    blurb: "경고·차단·타임아웃과 서버 관리를 도와줘요",
    names: [
      "경고",
      "차단",
      "추방",
      "타임아웃",
      "서버관리",
      "로그채널설정",
      "관리자",
    ],
  },
  {
    key: "owner",
    emoji: "🔒",
    label: "봇 운영자 전용",
    color: "#868E96",
    blurb: "",
    names: ["운영"],
    ownerOnly: true,
  },
];
const OTHER = {
  key: "other",
  emoji: "📦",
  label: "기타",
  color: "#868E96",
  blurb: "",
  names: [],
};

for (const c of [...CATEGORIES, OTHER]) c.title = `${c.emoji} ${c.label}`;

/**
 * 명령어 [{name, json}]를 분류별로 나눈다 (목록에 없는 것은 "기타", 비어 있는 분류는 뺀다).
 * 분류 안에서는 위 names의 순서를 따른다.
 */
function groupByCategory(commands) {
  const groups = CATEGORIES.map((c) => ({ ...c, commands: [] }));
  const other = { ...OTHER, commands: [] };
  for (const c of commands)
    (groups.find((g) => g.names.includes(c.name)) ?? other).commands.push(c);
  for (const g of groups)
    g.commands.sort(
      (a, b) => g.names.indexOf(a.name) - g.names.indexOf(b.name),
    );
  return [...groups, other].filter((g) => g.commands.length);
}

/** 옵션 표기: 필수는 <이름>, 선택은 [이름] (하위 명령은 제외) */
const optionsText = (opts = []) =>
  opts
    .filter((o) => o.type !== 1 && o.type !== 2)
    .map((o) => (o.required ? ` <${o.name}>` : ` [${o.name}]`))
    .join("");

// 옵션 종류 이름 (Discord ApplicationCommandOptionType)
const TYPE_LABELS = {
  3: "글자",
  4: "정수",
  5: "예/아니오",
  6: "유저",
  7: "채널",
  8: "역할",
  9: "유저·역할",
  10: "숫자",
  11: "파일",
};

/** 옵션 하나를 사이트·도움말에서 쓰기 좋게 정리한다 */
const optionInfo = (o) => ({
  name: o.name,
  description: o.description,
  required: Boolean(o.required),
  type: TYPE_LABELS[o.type] ?? "값",
  ...(o.choices?.length ? { choices: o.choices.map((c) => c.name) } : {}),
  ...(o.min_value !== undefined || o.max_value !== undefined
    ? { range: [o.min_value ?? null, o.max_value ?? null] }
    : {}),
  ...(o.autocomplete ? { autocomplete: true } : {}),
});
const plainOptions = (opts = []) =>
  opts.filter((o) => o.type !== 1 && o.type !== 2).map(optionInfo);

/**
 * 한 명령어의 사용법: { description, usages: [{ sub, syntax, description, options }] }
 * 하위 명령(그룹 안의 하위 명령 포함)마다 한 줄, 없으면 명령어 자체가 한 줄
 */
function usageOf(json) {
  const usages = [];
  for (const o of json.options ?? []) {
    if (o.type === 1) {
      usages.push({
        sub: o.name,
        syntax: `/${json.name} ${o.name}${optionsText(o.options)}`,
        description: o.description,
        options: plainOptions(o.options),
      });
    } else if (o.type === 2) {
      // /명령어 그룹 하위명령 (예: /유틸 디데이 추가)
      for (const s of o.options ?? []) {
        usages.push({
          sub: `${o.name} ${s.name}`,
          syntax: `/${json.name} ${o.name} ${s.name}${optionsText(s.options)}`,
          description: s.description,
          options: plainOptions(s.options),
        });
      }
    }
  }
  if (!usages.length) {
    return {
      description: json.description,
      usages: [
        {
          sub: null,
          syntax: `/${json.name}${optionsText(json.options)}`,
          description: json.description,
          options: plainOptions(json.options),
        },
      ],
    };
  }
  return { description: json.description, usages };
}

module.exports = { CATEGORIES, groupByCategory, optionsText, usageOf };
