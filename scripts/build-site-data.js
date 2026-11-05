// 웹사이트(별도 폴더 02_OMNI-Bot_site)에 쓰는 데이터를 만든다: 명령어 목록(_data/commands.json), 봇 정보·초대 주소(_data/bot.json)
// 사용법: node scripts/build-site-data.js   (사이트 폴더가 다른 곳이면 SITE_DIR=경로 를 지정한다)
// 명령어를 추가·수정했을 때 한 번 실행하고, 사이트 폴더의 _data 변경을 사이트 저장소에 커밋하면 반영된다. DB·Discord에는 접속하지 않는다.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true }); // 초대 주소에 쓸 CLIENT_ID(공개 정보)만 읽는다

// 명령어 파일들이 불러오는 Database.js를 가짜 객체로 바꿔서 game.db에 접속하지 않게 한다
const makeStub = () =>
  new Proxy(function () {}, {
    get: (_, key) =>
      key === "then"
        ? undefined
        : key === Symbol.toPrimitive
          ? () => "stub"
          : makeStub(),
    apply: () => makeStub(),
    construct: () => makeStub(),
  });
const dbPath = require.resolve(path.join(ROOT, "Database.js"));
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: makeStub(),
};

const { PermissionFlagsBits: P } = require("discord.js");
const { CATEGORIES, groupByCategory, usageOf } = require(
  path.join(ROOT, "bot/commandInfo.js"),
);

// ---------- 명령어 읽기 ----------
const commands = require(path.join(ROOT, "bot/commandLoader.js"))
  .loadCommands()
  .map((mod) => ({ name: mod.data.name, json: mod.data.toJSON() }));

const ownerOnly = new Set(
  CATEGORIES.filter((c) => c.ownerOnly).flatMap((c) => c.names),
);
const publicCommands = commands.filter((c) => !ownerOnly.has(c.name)); // 봇 운영자 전용 명령어는 사이트에 싣지 않는다
const groups = groupByCategory(publicCommands);

const siteCommands = {
  total: publicCommands.length,
  categories: groups.map((g) => ({
    key: g.key,
    emoji: g.emoji,
    label: g.label,
    color: g.color,
    blurb: g.blurb,
    count: g.commands.length,
    commands: g.commands.map((c) => {
      const u = usageOf(c.json);
      return { name: c.name, description: u.description, usages: u.usages };
    }),
  })),
};

// ---------- 초대 주소 ----------
// 봇이 하는 일에 필요한 권한만 요청한다 (관리자 권한은 요청하지 않는다)
const PERMISSIONS = [
  P.ViewChannel,
  P.SendMessages,
  P.SendMessagesInThreads,
  P.EmbedLinks,
  P.ReadMessageHistory,
  P.Connect,
  P.Speak, // 음악
  P.ManageMessages,
  P.ManageChannels, // 메시지 정리, 슬로우모드·채널 잠금
  P.KickMembers,
  P.BanMembers,
  P.ModerateMembers, // 추방·차단·타임아웃
  P.ChangeNickname, // 서버 별명(OMNI) 자동 설정
];
const permissions = PERMISSIONS.reduce((sum, p) => sum | p, 0n).toString();
const clientId = process.env.CLIENT_ID?.trim();
const invite = clientId
  ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&permissions=${permissions}&scope=${encodeURIComponent("bot applications.commands")}`
  : null;

const bot = {
  name: "OMNI",
  command_total: siteCommands.total,
  category_total: groups.length,
  subcommand_total: publicCommands.reduce(
    (n, c) => n + Math.max(usageOf(c.json).usages.length, 1),
    0,
  ),
  invite_url: invite,
  invite_permissions: permissions,
  contact: "dev@felnut.com",
  github: "https://github.com/felnut/OMNI-Bot",
  generated_at: new Date().toISOString().slice(0, 10),
};

// 사이트 폴더: 기본은 이 저장소 옆의 02_OMNI-Bot_site
const SITE_DIR = path.resolve(
  process.env.SITE_DIR || path.join(ROOT, "..", "02_OMNI-Bot_site"),
);
if (!fs.existsSync(SITE_DIR)) {
  console.error(
    `❌ 사이트 폴더를 찾지 못했어요: ${SITE_DIR}\nSITE_DIR=사이트폴더경로 로 위치를 알려 주세요.`,
  );
  process.exit(1);
}
const dataDir = path.join(SITE_DIR, "_data");
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(
  path.join(dataDir, "commands.json"),
  JSON.stringify(siteCommands, null, 2) + "\n",
);
fs.writeFileSync(
  path.join(dataDir, "bot.json"),
  JSON.stringify(bot, null, 2) + "\n",
);
console.log(
  `명령어 ${bot.command_total}개(사용법 ${bot.subcommand_total}개), 분류 ${bot.category_total}개 → ${path.join(dataDir, "commands.json")}`,
);
console.log(
  invite
    ? `초대 주소 생성 (권한 ${permissions}) → ${path.join(dataDir, "bot.json")}`
    : "⚠️ CLIENT_ID가 없어 초대 주소를 만들지 못했어요",
);
process.exit(0);
