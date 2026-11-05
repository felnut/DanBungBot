const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} = require("discord.js");
const crypto = require("node:crypto");
const db = require("../../../Database");
const cache = require("../utils/cache");
const progress = require("../../managers/progress");
const { GUILD_RANK_ENABLED } = require("../../config");
const { pickWeighted } = require("../../managers/instantGame");
const {
  tableFor,
  rollSize,
  sizeClass,
  fishImage,
  RODS,
  BAITS,
  BAIT_BY_KEY,
  DEX_BONUS_MULT,
} = require("../../managers/fishData");

// 낚시 한 판의 흐름
//  1) 미끼를 쓰고 찌를 던진다 → 입질이 올 때까지 기다린다 (임베드 문구가 "입질이 왔어요!"로 바뀐다)
//  2) 입질 신호가 오면 제한 시간 안에 [끌어올리기]를 누른다 (신호 전에 누르거나 늦으면 놓친다)
//  3) 낚싯줄 당기기: 매 라운드 정해진 색 버튼을 누른다. 3번 맞히면 잡히고, 3번 틀리면 도망간다
//  4) 잡으면 물고기를 정해서 바로 판매한다 (물고기는 맞힌 뒤에 정하므로 미리 알 수 없다)
//  5) 결과 화면의 [한 번 더] 버튼으로 같은 미끼로 이어서 낚시한다
const NEED = 3; // 잡는 데 필요한 성공 횟수
const MAX_MISS = 3; // 이만큼 틀리면 도망간다
const TIMING = {
  biteMin: 2500,
  biteMax: 7000,
  pullWindow: 3000,
  roundWindow: 4000,
  againWindow: 60000,
}; // ms (테스트에서 줄여 쓴다)
const COLORS = [
  { key: "red", name: "빨강", emoji: "🟥", style: ButtonStyle.Danger },
  { key: "blue", name: "파랑", emoji: "🟦", style: ButtonStyle.Primary },
  { key: "green", name: "초록", emoji: "🟩", style: ButtonStyle.Success },
];

const active = new Set(); // 지금 낚시(입질~줄 당기기) 중인 사용자 — 한 번에 한 판

const stmtUser = db.prepare("SELECT money FROM user WHERE user_id = ?");
const stmtRod = db.prepare("SELECT rod FROM fishing_gear WHERE user_id = ?");
const stmtBait = db.prepare(
  "SELECT qty FROM fishing_bait WHERE user_id = ? AND kind = ?",
);
const stmtUseBait = db.prepare(
  "UPDATE fishing_bait SET qty = qty - 1 WHERE user_id = ? AND kind = ? AND qty > 0",
);
const stmtMoney = db.prepare(
  "UPDATE user SET money = money + ? WHERE user_id = ?",
);
const stmtSeen = db.prepare(
  "SELECT 1 FROM fish_log WHERE user_id = ? AND fish = ?",
);
const stmtLog = db.prepare(
  "INSERT INTO fish_log (user_id, fish, count) VALUES (?, ?, 1) ON CONFLICT(user_id, fish) DO UPDATE SET count = count + 1",
);
const stmtBest = db.prepare(
  "SELECT cm FROM fish_best WHERE user_id = ? AND fish = ?",
);
const stmtSetBest = db.prepare(
  "INSERT INTO fish_best (user_id, fish, cm) VALUES (?, ?, ?) ON CONFLICT(user_id, fish) DO UPDATE SET cm = excluded.cm",
);
const stmtGuildBest = db.prepare(
  "SELECT cm FROM fish_record WHERE guild_id = ? AND fish = ?",
);
const stmtSetGuildBest = db.prepare(
  "INSERT INTO fish_record (guild_id, fish, cm, user_id) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, fish) DO UPDATE SET cm = excluded.cm, user_id = excluded.user_id",
);

/** 던질 때: 미끼를 하나 쓴다 (놓치거나 도망가도 미끼는 돌려주지 않는다) */
const takeBait = db.transaction((userId, baitKey) => {
  if (!stmtUser.get(userId)) return { error: "NOT_REGISTERED" };
  const bait = BAIT_BY_KEY.get(baitKey);
  if (!stmtUseBait.run(userId, baitKey).changes)
    return { error: "NO_BAIT", bait };
  return {
    bait,
    left: stmtBait.get(userId, baitKey)?.qty ?? 0,
    rod: stmtRod.get(userId)?.rod ?? 0,
  };
});

/**
 * 잡았을 때: 물고기와 크기를 정하고 판매가를 바로 지급한다.
 * 도감에 처음 올리는 어종이면 보너스(미끼값 × DEX_BONUS_MULT)를 한 번 더 준다. 서버 신기록은 서버별 이용 기록 기능이 켜져 있을 때만 남긴다.
 */
const landFish = db.transaction((userId, guildId, bait) => {
  const rod = stmtRod.get(userId)?.rod ?? 0;
  const fish = pickWeighted(tableFor(rod));
  const cm = rollSize(fish, () => crypto.randomInt(0, 1_000_000) / 1_000_000);
  const price = Math.floor(bait.price * fish.mult);
  const firstCatch = !stmtSeen.get(userId, fish.key);
  const bonus = firstCatch ? bait.price * DEX_BONUS_MULT : 0;
  stmtMoney.run(price + bonus, userId);
  stmtLog.run(userId, fish.key);

  const prev = stmtBest.get(userId, fish.key)?.cm ?? 0;
  const personalBest = cm > prev;
  if (personalBest) stmtSetBest.run(userId, fish.key, cm);
  let serverBest = false;
  if (GUILD_RANK_ENABLED && guildId) {
    serverBest = cm > (stmtGuildBest.get(guildId, fish.key)?.cm ?? 0);
    if (serverBest) stmtSetGuildBest.run(guildId, fish.key, cm, userId);
  }
  return {
    fish,
    cm,
    price,
    bonus,
    firstCatch,
    personalBest,
    serverBest,
    prevBest: prev,
    rod,
    balance: stmtUser.get(userId).money,
  };
});

const rand = (min, max) => crypto.randomInt(min, max + 1);
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const scene = (color, title, text, footer) => {
  const e = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(text);
  return footer ? e.setFooter({ text: footer }) : e;
};
const gauge = (ok, miss) =>
  `🎯 ${"🟩".repeat(ok)}${"⬜".repeat(NEED - ok)}　💢 ${"❌".repeat(miss)}${"⬜".repeat(MAX_MISS - miss)}`;

/** 잡은 결과 화면: 판매 안내, 한마디, 잔액, 크기, 기록, 도감 보너스 */
function catchEmbed(r, bait, left, ok, miss) {
  const net = r.price + r.bonus - bait.price;
  const lines = [
    `**${r.fish.name}**를 **${r.price.toLocaleString()}원**에 판매했어요! (${r.fish.mult}배)`,
    r.fish.line,
    "",
    `현재 보유금액: ${r.balance.toLocaleString()}원`,
    `📏 ${r.cm}cm · ${sizeClass(r.fish, r.cm)}`,
  ];
  if (r.personalBest)
    lines.push(
      r.prevBest
        ? `🎉 내 최고 기록 경신! (이전 ${r.prevBest}cm)`
        : "🎉 내 첫 기록!",
    );
  if (r.serverBest) lines.push("🏠 **서버 신기록!**");
  if (r.firstCatch)
    lines.push(
      `📖 도감 첫 등록! ${bait.price.toLocaleString()}원 × ${DEX_BONUS_MULT} = ${r.bonus.toLocaleString()}원 지급`,
    );
  lines.push(
    "",
    `${gauge(ok, miss)}`,
    `💵 수익 ${net > 0 ? "+" : ""}${net.toLocaleString()}원 (미끼값 ${bait.price.toLocaleString()}원)`,
  );
  return new EmbedBuilder()
    .setColor(net > 0 ? 0x57f287 : net < 0 ? 0xed4245 : 0xfee75c)
    .setTitle("🎣 낚시 시작")
    .setDescription(lines.join("\n"))
    .setThumbnail(fishImage(r.fish))
    .setFooter({
      text: `${bait.name} ${left.toLocaleString()}개 남음 · ${RODS[r.rod].name}`,
    });
}

async function play(interaction, firstTaken) {
  const userId = interaction.user.id;
  const prefix = `fish:${interaction.id}:`;
  let message = null;
  let pending = null; // 아직 응답하지 않은 마지막 버튼 클릭 (화면은 이 클릭으로 갱신한다)
  let shown = false;
  const show = async (payload) => {
    if (pending) {
      const p = pending;
      pending = null;
      return p.update(payload);
    }
    if (!shown) {
      shown = true;
      await interaction.reply(payload);
      message = await interaction.fetchReply();
      return;
    }
    return interaction.editReply(payload);
  };
  /** 내가 누른 버튼을 기다린다. 시간이 지나면 null */
  const click = (ms) =>
    message
      .awaitMessageComponent({
        filter: (i) => i.user.id === userId && i.customId.startsWith(prefix),
        componentType: ComponentType.Button,
        time: ms,
      })
      .catch(() => null);

  const pullRow = () =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}pull`)
        .setLabel("끌어올리기")
        .setEmoji("🎣")
        .setStyle(ButtonStyle.Primary),
    );
  /** 결과 화면 아래 [한 번 더] 버튼. 미끼가 없으면 눌러도 소용없으므로 끈다 */
  const againRow = (taken) =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}again`)
        .setLabel(
          taken.left > 0
            ? `한 번 더 (${taken.bait.name} ${taken.left.toLocaleString()}개)`
            : "미끼가 없어요",
        )
        .setEmoji("🎣")
        .setStyle(ButtonStyle.Success)
        .setDisabled(taken.left <= 0),
    );

  /** 한 판: 던지기 → 입질 → 끌어올리기 → 줄 당기기 → 결과. 마지막 화면은 [한 번 더] 버튼과 함께 보여 준다 */
  async function castOnce(taken) {
    await show({
      embeds: [
        scene(
          0x3498db,
          "🎣 낚시",
          `${taken.bait.name}를 달아 찌를 던졌어요.\n입질이 올 때까지 기다리세요… 🌊`,
          `남은 미끼 ${taken.left.toLocaleString()}개 · ${RODS[taken.rod].name}`,
        ),
      ],
      components: [pullRow()],
    });
    const end = (embed) =>
      show({ embeds: [embed], components: [againRow(taken)] });

    // 1) 입질을 기다린다 — 신호 전에 누르면 놓친다. 좋은 낚싯대일수록 입질이 빨리 온다
    const early = await click(
      Math.round(rand(TIMING.biteMin, TIMING.biteMax) * RODS[taken.rod].bite),
    );
    if (early) {
      pending = early;
      return end(
        scene(
          0x95a5a6,
          "🎣 너무 일찍 당겼어요",
          "아직 입질이 아니었어요. 물고기가 놀라서 도망갔어요… 💨",
          "미끼는 돌려받지 못해요",
        ),
      );
    }

    // 2) 입질 신호: 임베드 문구를 바꿔서 알린다
    await show({
      embeds: [
        scene(
          0xf1c40f,
          "❗ 입질이 왔어요!",
          "**찌가 움찔움찔!** 지금 바로 **끌어올리기**를 누르세요!",
          `${TIMING.pullWindow / 1000}초 안에 눌러야 해요`,
        ),
      ],
      components: [pullRow()],
    });
    const pull = await click(TIMING.pullWindow);
    if (!pull)
      return end(
        scene(
          0x95a5a6,
          "🎣 놓쳤어요",
          "너무 늦었어요. 물고기가 미끼만 먹고 가버렸어요… 💨",
          "미끼는 돌려받지 못해요",
        ),
      );
    pending = pull;

    // 3) 낚싯줄 당기기: 정해진 색 버튼을 3번 맞히면 잡힌다
    let ok = 0;
    let miss = 0;
    let note = "물고기가 힘껏 버티고 있어요!";
    while (ok < NEED && miss < MAX_MISS) {
      const target = COLORS[rand(0, COLORS.length - 1)];
      const row = new ActionRowBuilder().addComponents(
        shuffle(COLORS).map((c) =>
          new ButtonBuilder()
            .setCustomId(`${prefix}${c.key}`)
            .setLabel(c.name)
            .setEmoji(c.emoji)
            .setStyle(c.style),
        ),
      );
      await show({
        embeds: [
          scene(
            0xe67e22,
            "🎣 낚싯줄을 당기는 중!",
            `${note}\n\n**${target.emoji} ${target.name} 버튼**을 눌러서 줄을 당기세요!\n\n${gauge(ok, miss)}`,
            `${TIMING.roundWindow / 1000}초 안에 눌러야 해요 · ${NEED}번 맞히면 잡혀요`,
          ),
        ],
        components: [row],
      });
      const ans = await click(TIMING.roundWindow);
      if (!ans) {
        miss += 1;
        note = "⌛ 너무 느려서 줄이 풀렸어요!";
        continue;
      }
      pending = ans;
      if (ans.customId === `${prefix}${target.key}`) {
        ok += 1;
        note = "✅ 좋아요! 줄이 팽팽해졌어요!";
      } else {
        miss += 1;
        note = "❌ 잘못 당겼어요! 줄이 느슨해졌어요!";
      }
    }
    if (ok < NEED)
      return end(
        scene(
          0xed4245,
          "🎣 도망갔어요…",
          `줄이 풀려서 물고기가 도망갔어요.\n\n${gauge(ok, miss)}`,
          "미끼는 돌려받지 못해요",
        ),
      );

    // 4) 잡았다 → 바로 판매
    const r = landFish(userId, interaction.guildId, taken.bait);
    cache.invalidateMoney(userId);
    progress.record(userId, "fish");
    return end(catchEmbed(r, taken.bait, taken.left, ok, miss).setTimestamp());
  }

  // 한 판씩 이어서: 결과 화면의 [한 번 더]를 누르면 같은 미끼로 다시 던진다
  let taken = firstTaken;
  for (;;) {
    active.add(userId);
    try {
      await castOnce(taken);
    } finally {
      active.delete(userId);
    }
    if (taken.left <= 0) return;
    const again = await click(TIMING.againWindow);
    if (!again || again.customId !== `${prefix}again`) {
      return interaction.editReply({ components: [] }).catch(() => {});
    }
    pending = again;
    const next = takeBait(userId, taken.bait.key);
    if (next.error) {
      return show({
        embeds: [
          scene(
            0x95a5a6,
            "🎣 미끼가 없어요",
            `${taken.bait.name}가 다 떨어졌어요. \`/낚시 상점\`에서 사 주세요!`,
          ),
        ],
        components: [],
      });
    }
    taken = next;
  }
}

module.exports = {
  TIMING,
  data: new SlashCommandBuilder()
    .setName("낚시")
    .setDescription(
      "미끼를 달고 낚시해요! 입질이 오면 끌어올리고, 버튼을 3번 맞히면 잡혀서 바로 팔려요",
    )
    .addStringOption((o) =>
      o
        .setName("미끼")
        .setDescription("쓸 미끼 (기본: 일반 미끼)")
        .addChoices(
          ...BAITS.map((b) => ({
            name: `${b.name} (${b.price.toLocaleString()}원짜리)`,
            value: b.key,
          })),
        ),
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    if (active.has(userId)) {
      return interaction.reply({
        content: "이미 낚시 중이에요! 먼저 하던 낚시를 끝내 주세요 🎣",
        flags: MessageFlags.Ephemeral,
      });
    }
    const taken = takeBait(
      userId,
      interaction.options.getString("미끼") ?? "basic",
    );
    if (taken.error === "NOT_REGISTERED")
      return interaction.reply({
        content: "먼저 `/게임 가입`으로 가입해주세요!",
        flags: MessageFlags.Ephemeral,
      });
    if (taken.error) {
      return interaction.reply({
        content: `🪱 ${taken.bait.name}가 없어요. \`/낚시 상점\`에서 먼저 사 주세요!`,
        flags: MessageFlags.Ephemeral,
      });
    }
    await play(interaction, taken);
  },
};
