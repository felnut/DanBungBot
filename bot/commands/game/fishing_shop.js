// /낚시 상점: 선택 메뉴에서 낚싯대·미끼를 골라 산다 (낚싯대는 바로 구매, 미끼는 수량 입력창이 열린다)
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database");
const cache = require("../utils/cache");
const {
  RODS,
  BAITS,
  BAIT_BY_KEY,
  MAX_BAIT_PER_KIND,
  FISH,
} = require("../../managers/fishData");

const SHOP_MS = 3 * 60 * 1000; // 상점 화면을 열어 두는 시간
const MAX_BUY = 100; // 한 번에 살 수 있는 미끼 수
const EPHEMERAL = MessageFlags.Ephemeral;
const won = (n) => `${n.toLocaleString()}원`;

const stmtUser = db.prepare("SELECT money FROM user WHERE user_id = ?");
const stmtMoney = db.prepare(
  "UPDATE user SET money = money + ? WHERE user_id = ?",
);
const stmtBait = db.prepare(
  "SELECT qty FROM fishing_bait WHERE user_id = ? AND kind = ?",
);
const stmtBaits = db.prepare(
  "SELECT kind, qty FROM fishing_bait WHERE user_id = ?",
);
const stmtAddBait = db.prepare(
  "INSERT INTO fishing_bait (user_id, kind, qty) VALUES (?, ?, ?) ON CONFLICT(user_id, kind) DO UPDATE SET qty = qty + excluded.qty",
);
const stmtRod = db.prepare("SELECT rod FROM fishing_gear WHERE user_id = ?");
const stmtSetRod = db.prepare(
  "INSERT INTO fishing_gear (user_id, rod) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET rod = excluded.rod",
);

const buyBait = db.transaction((userId, kind, qty) => {
  const user = stmtUser.get(userId);
  if (!user) return { error: "NOT_REGISTERED" };
  const bait = BAIT_BY_KEY.get(kind);
  const have = stmtBait.get(userId, kind)?.qty ?? 0;
  if (have + qty > MAX_BAIT_PER_KIND) return { error: "TOO_MANY", have };
  const cost = bait.price * qty;
  if (user.money < cost) return { error: "INSUFFICIENT_MONEY", cost };
  stmtMoney.run(-cost, userId);
  stmtAddBait.run(userId, kind, qty);
  return { bait, cost, have: have + qty, balance: user.money - cost };
});

const buyRod = db.transaction((userId, level) => {
  const user = stmtUser.get(userId);
  if (!user) return { error: "NOT_REGISTERED" };
  const current = stmtRod.get(userId)?.rod ?? 0;
  if (level <= current) return { error: "ALREADY", current };
  const cost = RODS[level].price;
  if (user.money < cost) return { error: "INSUFFICIENT_MONEY", cost };
  stmtMoney.run(-cost, userId);
  stmtSetRod.run(userId, level);
  return { cost, balance: user.money - cost };
});

/** 낚싯대 한 줄 설명: 입질 단축 + 새로 나타나는 어종 */
function rodInfo(level) {
  const faster = Math.round((1 - RODS[level].bite) * 100);
  const fish = FISH.filter((f) => f.rod === level)
    .map((f) => f.name.split(" ")[0])
    .join("");
  return `입질 ${faster}% 빨라짐${fish ? ` · 새 어종 ${fish}` : ""}`;
}
const baitInfo = (b) =>
  `한 번에 ${won(b.price)}어치 · 최대 ${MAX_BAIT_PER_KIND}개`;

function shopEmbed() {
  const rods = RODS.slice(1).map(
    (r, i) => `**${r.name}** · ${won(r.price)}\n└ ${rodInfo(i + 1)}`,
  );
  const baits = BAITS.map(
    (b) => `**${b.name}** · ${won(b.price)}\n└ ${baitInfo(b)}`,
  );
  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("🏪 낚시 상점")
    .setDescription(
      "살 물건을 아래 메뉴에서 골라요. 낚싯대는 바로 사고, 미끼는 수량을 입력해요.\n내 잔액과 가진 물건은 **내 지갑·보유** 버튼에서 확인해요.",
    )
    .addFields(
      { name: "🎣 낚싯대", value: rods.join("\n") },
      { name: "🪱 미끼", value: baits.join("\n") },
    )
    .setFooter({
      text: "낚싯대는 더 높은 단계로만 살 수 있어요 · 환수율은 낚싯대와 상관없이 같아요",
    });
}

const menuRows = () => [
  new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("fshop:select")
      .setPlaceholder("구매할 아이템을 선택하세요")
      .addOptions([
        ...RODS.slice(1).map((r, i) => ({
          label: r.name,
          description: `${won(r.price)} · ${rodInfo(i + 1)}`.slice(0, 100),
          emoji: "🎣",
          value: `rod:${i + 1}`,
        })),
        ...BAITS.map((b) => ({
          label: b.name,
          description: `${won(b.price)} · ${baitInfo(b)}`.slice(0, 100),
          emoji: "🪱",
          value: `bait:${b.key}`,
        })),
      ]),
  ),
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("fshop:wallet")
      .setLabel("내 지갑·보유")
      .setEmoji("💰")
      .setStyle(ButtonStyle.Secondary),
  ),
];

function walletEmbed(userId, username) {
  const money = stmtUser.get(userId)?.money ?? 0;
  const rod = stmtRod.get(userId)?.rod ?? 0;
  const have = new Map(stmtBaits.all(userId).map((r) => [r.kind, r.qty]));
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`💰 ${username}님의 지갑·보유`)
    .addFields(
      { name: "잔액", value: won(money), inline: true },
      { name: "낚싯대", value: RODS[rod].name, inline: true },
      {
        name: "미끼",
        value: BAITS.map(
          (b) => `${b.name} **${(have.get(b.key) ?? 0).toLocaleString()}개**`,
        ).join("\n"),
      },
    );
}

const result = (color, title, text) =>
  new EmbedBuilder().setColor(color).setTitle(title).setDescription(text);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("낚시상점")
    .setDescription("낚싯대와 미끼를 사요 (메뉴에서 골라요)"),

  async execute(interaction) {
    const userId = interaction.user.id;
    if (!stmtUser.get(userId))
      return interaction.reply({
        content: "먼저 `/게임 가입`으로 가입해주세요!",
        flags: EPHEMERAL,
      });

    await interaction.reply({ embeds: [shopEmbed()], components: menuRows() });
    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
      filter: (i) => i.user.id === userId,
      time: SHOP_MS,
    });
    const resetMenu = () =>
      interaction.editReply({ components: menuRows() }).catch(() => {}); // 고른 항목 표시를 지워서 다시 고를 수 있게

    collector.on("collect", async (i) => {
      try {
        if (i.componentType === ComponentType.Button) {
          return i.reply({
            embeds: [walletEmbed(userId, interaction.user.username)],
            flags: EPHEMERAL,
          });
        }
        const [kind, value] = i.values[0].split(":");

        if (kind === "rod") {
          const level = Number(value);
          const r = buyRod(userId, level);
          if (r.error === "ALREADY")
            await i.reply({
              content: `이미 ${RODS[r.current].name} 이상을 가지고 있어요.`,
              flags: EPHEMERAL,
            });
          else if (r.error)
            await i.reply({
              content: `💸 돈이 부족해요! (필요: ${won(r.cost)})`,
              flags: EPHEMERAL,
            });
          else {
            cache.invalidateMoney(userId);
            const unlocked = FISH.filter((f) => f.rod === level)
              .map((f) => f.name)
              .join(", ");
            await i.reply({
              embeds: [
                result(
                  0x3498db,
                  `🎣 ${RODS[level].name}를 샀어요!`,
                  `${rodInfo(level)}${unlocked ? `\n새로 나타나는 물고기: **${unlocked}**` : ""}\n쓴 돈 ${won(r.cost)}\n\n💰 현재 잔액 **${won(r.balance)}**`,
                ),
              ],
              flags: EPHEMERAL,
            });
          }
          return resetMenu();
        }

        // 미끼: 수량 입력창
        const bait = BAIT_BY_KEY.get(value);
        const modalId = `fshop:qty:${i.id}`;
        await i.showModal(
          new ModalBuilder()
            .setCustomId(modalId)
            .setTitle(`${bait.name} 구매`)
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("qty")
                  .setLabel(`수량 (1~${MAX_BUY}, ${won(bait.price)}씩)`)
                  .setPlaceholder("예: 10")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setMaxLength(3),
              ),
            ),
        );
        const sub = await i
          .awaitModalSubmit({
            time: 2 * 60 * 1000,
            filter: (m) => m.customId === modalId && m.user.id === userId,
          })
          .catch(() => null);
        if (!sub) return resetMenu();
        const text = sub.fields.getTextInputValue("qty").trim();
        const qty = Number(text);
        if (!/^\d{1,3}$/.test(text) || qty < 1 || qty > MAX_BUY) {
          await sub.reply({
            content: `수량은 1~${MAX_BUY} 사이의 숫자로 넣어 주세요.`,
            flags: EPHEMERAL,
          });
          return resetMenu();
        }
        const r = buyBait(userId, bait.key, qty);
        if (r.error === "TOO_MANY")
          await sub.reply({
            content: `미끼는 한 종류당 ${MAX_BAIT_PER_KIND}개까지만 가질 수 있어요. (지금 ${r.have}개)`,
            flags: EPHEMERAL,
          });
        else if (r.error)
          await sub.reply({
            content: `💸 돈이 부족해요! (필요: ${won(r.cost)})`,
            flags: EPHEMERAL,
          });
        else {
          cache.invalidateMoney(userId);
          await sub.reply({
            embeds: [
              result(
                0x57f287,
                "🪱 미끼를 샀어요",
                `${bait.name} → 지금 **${r.have.toLocaleString()}개**\n쓴 돈 ${won(r.cost)}\n\n💰 현재 잔액 **${won(r.balance)}**`,
              ),
            ],
            flags: EPHEMERAL,
          });
        }
        return resetMenu();
      } catch (e) {
        console.error("낚시 상점 처리 오류:", e?.message ?? e);
      }
    });
    collector.on("end", () =>
      interaction.editReply({ components: [] }).catch(() => {}),
    );
  },
};
