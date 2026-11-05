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
const { rankingEmbed } = require("../../managers/rankings");

// 무기 강화: 돈을 쓰는 곳. 생성비·단계별 강화비·판매가는 bot/managers/weaponData.js에 있다.
// 한 사람이 최대 MAX_WEAPONS개까지 가질 수 있고, 무기마다 이름이 있다 (이름으로 무기를 고른다).
const {
  CREATE_COST,
  MAX_WEAPONS,
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
} = require("../../managers/weaponData");

const label = (name, level) => `${name} +${level}`;
const won = (n) => `${n.toLocaleString()}원`;
const EPHEMERAL = MessageFlags.Ephemeral;

const stmtUser = db.prepare("SELECT money FROM user WHERE user_id = ?");
const stmtMoney = db.prepare(
  "UPDATE user SET money = money + ? WHERE user_id = ?",
);
const stmtAll = db.prepare(
  "SELECT id, name, level, exp, best_level FROM weapons WHERE user_id = ? ORDER BY level DESC, id ASC",
);
const stmtByName = db.prepare(
  "SELECT id, name, level, exp, best_level FROM weapons WHERE user_id = ? AND name = ?",
);
const stmtInsert = db.prepare(
  "INSERT INTO weapons (user_id, name, level, best_level, updated_at) VALUES (?, ?, 0, 0, ?)",
);
const stmtUpdate = db.prepare(
  "UPDATE weapons SET level = ?, exp = ?, best_level = MAX(best_level, ?), updated_at = ? WHERE id = ?",
);
const stmtDelete = db.prepare("DELETE FROM weapons WHERE id = ?");

const notRegistered = (i) =>
  i.reply({ content: "먼저 `/게임 가입`으로 가입해주세요!", flags: EPHEMERAL });
const noWeapon = (i) =>
  i.reply({
    content: "무기가 없어요. `/무기 생성`으로 먼저 만들어 보세요!",
    flags: EPHEMERAL,
  });
const lackMoney = (i, need) =>
  i.reply({
    content: `💸 돈이 부족해요! (필요: ${won(need)})`,
    flags: EPHEMERAL,
  });

/**
 * 어느 무기인지 정한다. 이름을 줬으면 그 무기, 안 줬으면 무기가 하나뿐일 때만 그 무기.
 * 반환: { weapon } 또는 { error: "NO_WEAPON" | "NOT_FOUND" | "AMBIGUOUS", list }
 */
function findWeapon(userId, name) {
  const list = stmtAll.all(userId);
  if (!list.length) return { error: "NO_WEAPON", list };
  if (name) {
    const w = stmtByName.get(userId, name.trim());
    return w ? { weapon: w, list } : { error: "NOT_FOUND", list };
  }
  return list.length === 1
    ? { weapon: list[0], list }
    : { error: "AMBIGUOUS", list };
}

/** findWeapon의 오류를 사용자에게 알린다. 정상이면 null */
function pickError(i, r) {
  if (!r.error) return null;
  if (r.error === "NO_WEAPON") return noWeapon(i);
  const names = r.list.map((w) => `**${w.name}**`).join(", ");
  const text =
    r.error === "NOT_FOUND"
      ? `그 이름의 무기가 없어요. 내 무기: ${names}`
      : `무기가 여러 개예요. \`무기\` 칸에서 이름을 골라 주세요. 내 무기: ${names}`;
  return i.reply({ content: text, flags: EPHEMERAL });
}

const create = db.transaction((userId, name) => {
  const user = stmtUser.get(userId);
  if (!user) return { error: "NOT_REGISTERED" };
  if (stmtAll.all(userId).length >= MAX_WEAPONS) return { error: "FULL" };
  if (stmtByName.get(userId, name)) return { error: "DUPLICATE" };
  if (user.money < CREATE_COST) return { error: "INSUFFICIENT_MONEY" };
  stmtMoney.run(-CREATE_COST, userId);
  const id = Number(stmtInsert.run(userId, name, Date.now()).lastInsertRowid);
  return {
    id,
    balance: user.money - CREATE_COST,
    count: stmtAll.all(userId).length,
  };
});

const enhance = db.transaction((userId, weaponId) => {
  const user = stmtUser.get(userId);
  if (!user) return { error: "NOT_REGISTERED" };
  const weapon = stmtAll.all(userId).find((w) => w.id === weaponId);
  if (!weapon) return { error: "NO_WEAPON" };
  if (weapon.level >= MAX_LEVEL) return { error: "MAX_LEVEL" };
  const [cost, chance, loseExp] = STEPS[weapon.level];
  if (user.money < cost) return { error: "INSUFFICIENT_MONEY", need: cost };
  stmtMoney.run(-cost, userId);
  const success = Math.random() < chance;
  let level = weapon.level;
  let exp = weapon.exp;
  let gain = 0; // 이번에 얻은 경험치
  let lost = 0; // 이번에 깎인 경험치
  let levelUp = false;
  if (success) {
    gain = rollGain(crypto.randomInt);
    exp += gain;
    // 경험치가 필요량을 넘으면 다음 단계로 (넘친 경험치는 없어진다)
    if (exp >= expNeed(weapon.level)) {
      level += 1;
      exp = 0;
      levelUp = true;
    }
  } else if (loseExp) {
    lost = Math.min(EXP_LOSS, exp);
    exp -= lost;
  }
  stmtUpdate.run(level, exp, level, Date.now(), weapon.id);
  return {
    success,
    from: weapon.level,
    level,
    exp,
    expBefore: weapon.exp,
    gain,
    lost,
    levelUp,
    cost,
    chance,
    loseExp,
    name: weapon.name,
    balance: user.money - cost,
  };
});

const sell = db.transaction((userId, weaponId) => {
  const user = stmtUser.get(userId);
  if (!user) return { error: "NOT_REGISTERED" };
  const weapon = stmtAll.all(userId).find((w) => w.id === weaponId);
  if (!weapon) return { error: "NO_WEAPON" };
  const price = SELL_PRICE[weapon.level];
  stmtMoney.run(price, userId);
  stmtDelete.run(weapon.id);
  return {
    level: weapon.level,
    name: weapon.name,
    price,
    balance: user.money + price,
    left: stmtAll.all(userId).length,
  };
});

/** 강화 결과 화면: 결과·레벨·경험치·진행도(칸)·확률·비용을 필드로 나눠서 보여 준다 */
function enhanceEmbed(userId, r) {
  const pct = Math.round(r.chance * 100);
  const levelLine = r.levelUp
    ? `레벨: +${r.from} ➜ +${r.level} (+1) 🎉 레벨 업!`
    : `레벨: +${r.level} (유지)`;
  const expLine = r.success
    ? `경험치: +${r.gain} EXP${r.levelUp ? ` (${expNeed(r.from).toLocaleString()} 초과!)` : ""}`
    : r.lost
      ? `경험치: -${r.lost} EXP`
      : "경험치: 없음";
  const expShown =
    r.level >= MAX_LEVEL
      ? "최고 단계예요!"
      : `${expBar(r.exp, r.level)} ${expText(r.exp, r.level)}`;
  return new EmbedBuilder()
    .setColor(r.levelUp ? 0xf1c40f : r.success ? 0x57f287 : 0xed4245)
    .setTitle("⚔️ 무기 강화")
    .setDescription(`<@${userId}>님의 무기 강화 결과`)
    .addFields(
      {
        name: `${r.success ? "✨" : "💔"} ${r.name}`,
        value: [
          `**${r.success ? "성공!" : "실패…"}** (확률: ${r.success ? pct : 100 - pct}%)`,
          levelLine,
          expLine,
          `진행도: ${expShown}`,
          `단계: ${levelBar(r.level)} +${r.level}/${MAX_LEVEL}`,
        ].join("\n"),
      },
      {
        name: "🎲 강화 확률",
        value: [
          `✅ 성공: \`${pct}%\` (경험치 ${EXP_GAIN[0]}~${EXP_GAIN[1]} EXP)`,
          `❌ 실패: \`${100 - pct}%\` (${r.loseExp ? `경험치 ${EXP_LOSS} EXP 줄어요` : "경험치 변화 없음"})`,
        ].join("\n"),
      },
      {
        name: "💰 비용 정보",
        value: [`소모 비용: ${won(r.cost)}`, `잔액: ${won(r.balance)}`].join(
          "\n",
        ),
      },
    )
    .setFooter({
      text: `현재 등급: ${TIER_NAMES[r.level]} · ${r.level >= MAX_LEVEL ? "최고 단계예요!" : `경험치가 ${expNeed(r.level).toLocaleString()}을 넘으면 다음 단계로 올라가요`}`,
    });
}

const sellEmbed = (r) =>
  new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("💰 무기를 팔았어요")
    .setDescription(
      `**${label(r.name, r.level)}** → **${won(r.price)}**\n\n💰 현재 잔액 **${won(r.balance)}**\n🎒 남은 무기 ${r.left}/${MAX_WEAPONS}`,
    );

/** 무기 아래 버튼: 명령어를 다시 치지 않고 눌러서 강화·판매를 이어간다 */
function buttonRow(weaponId, level) {
  const next = STEPS[level];
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`wp:enh:${weaponId}`)
      .setLabel(next ? `강화 (${won(next[0])})` : "최고 단계")
      .setEmoji("⚔️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!next),
    new ButtonBuilder()
      .setCustomId(`wp:sell:${weaponId}`)
      .setLabel(`판매 (${won(SELL_PRICE[level])})`)
      .setEmoji("💰")
      .setStyle(ButtonStyle.Secondary),
  );
}

/** 보낸 답변에 버튼 처리를 붙인다. 누를 때마다 같은 메시지가 새 결과로 바뀌고, 90초 동안 아무도 안 누르면 버튼이 사라진다 */
async function attachButtons(interaction, weaponId) {
  const userId = interaction.user.id;
  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({
    filter: (i) =>
      i.user.id === userId &&
      i.customId.startsWith("wp:") &&
      i.customId.endsWith(`:${weaponId}`),
    componentType: ComponentType.Button,
    idle: 90_000,
  });
  collector.on("collect", async (i) => {
    try {
      if (i.customId.startsWith("wp:sell:")) {
        const r = sell(userId, weaponId);
        if (r.error) {
          collector.stop("gone");
          return i.update({
            content: "이 무기는 이미 없어요.",
            embeds: [],
            components: [],
          });
        }
        cache.invalidateMoney(userId);
        collector.stop("sold");
        return i.update({ embeds: [sellEmbed(r)], components: [] });
      }
      const r = enhance(userId, weaponId);
      if (r.error === "NO_WEAPON") {
        collector.stop("gone");
        return i.update({
          content: "이 무기는 이미 없어요.",
          embeds: [],
          components: [],
        });
      }
      if (r.error === "MAX_LEVEL")
        return i.reply({
          content: "이미 최고 단계예요! 팔아서 새 무기에 도전해 보세요.",
          flags: EPHEMERAL,
        });
      if (r.error)
        return i.reply({
          content: `💸 돈이 부족해요! (필요: ${won(r.need)})`,
          flags: EPHEMERAL,
        });
      cache.invalidateMoney(userId);
      progress.record(userId, "weapon");
      progress.recordMax(userId, "weapon_best", r.level);
      return i.update({
        embeds: [enhanceEmbed(userId, r)],
        components: [buttonRow(weaponId, r.level)],
      });
    } catch (e) {
      console.error("무기 버튼 처리 오류:", e?.message ?? e);
    }
  });
  collector.on("end", (_, reason) => {
    if (reason !== "sold" && reason !== "gone")
      interaction.editReply({ components: [] }).catch(() => {});
  });
}

const weaponOption = (o) =>
  o
    .setName("무기")
    .setDescription("무기 이름 (하나뿐이면 비워도 돼요)")
    .setAutocomplete(true)
    .setMaxLength(12);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("무기")
    .setDescription(
      `무기를 만들고 강화해요 (최대 ${MAX_WEAPONS}개, 최대 +10, 경험치를 쌓아 단계를 올려요)`,
    )
    .addSubcommand((s) =>
      s
        .setName("생성")
        .setDescription(
          `이름을 지어 무기를 만들어요 (${won(CREATE_COST)}, 최대 ${MAX_WEAPONS}개)`,
        )
        .addStringOption((o) =>
          o
            .setName("이름")
            .setDescription(
              "무기 이름 (한글·영문·숫자 12글자까지, 겹치면 안 돼요)",
            )
            .setRequired(true)
            .setMaxLength(12),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("강화")
        .setDescription(
          "무기를 강화해 경험치를 쌓아요 (경험치가 1,000부터 점점 늘어나는 한계를 넘으면 다음 단계)",
        )
        .addStringOption(weaponOption),
    )
    .addSubcommand((s) =>
      s
        .setName("정보")
        .setDescription("내 무기 목록, 또는 한 무기의 자세한 정보를 봐요")
        .addStringOption(weaponOption),
    )
    .addSubcommand((s) =>
      s
        .setName("판매")
        .setDescription("무기를 팔아요")
        .addStringOption(weaponOption),
    )
    .addSubcommand((s) =>
      s.setName("랭킹").setDescription("무기 단계 순위 (전체 + 이 서버 TOP 5)"),
    ),

  // 무기 이름 자동완성: 내가 가진 무기
  async autocomplete(interaction) {
    const typed = String(interaction.options.getFocused() ?? "")
      .trim()
      .toLowerCase();
    const choices = stmtAll
      .all(interaction.user.id)
      .filter((w) => !typed || w.name.toLowerCase().includes(typed))
      .map((w) => ({ name: `${w.name} (+${w.level})`, value: w.name }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === "생성") {
      const name = cleanName(interaction.options.getString("이름"));
      if (!name)
        return interaction.reply({
          content: "무기 이름은 한글·영문·숫자·공백만, 1~12글자로 지어 주세요.",
          flags: EPHEMERAL,
        });
      const r = create(userId, name);
      if (r.error === "NOT_REGISTERED") return notRegistered(interaction);
      if (r.error === "FULL")
        return interaction.reply({
          content: `무기는 ${MAX_WEAPONS}개까지 가질 수 있어요. 하나를 팔고 새로 만들어 주세요.`,
          flags: EPHEMERAL,
        });
      if (r.error === "DUPLICATE")
        return interaction.reply({
          content: `이미 **${name}** 이름의 무기가 있어요. 다른 이름을 지어 주세요.`,
          flags: EPHEMERAL,
        });
      if (r.error) return lackMoney(interaction, CREATE_COST);
      cache.invalidateMoney(userId);
      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("🔨 무기를 만들었어요!")
        .setDescription(
          `**${label(name, 0)}**을 손에 넣었어요. (${TIER_NAMES[0]})\n${levelBar(0)} +0/${MAX_LEVEL}\n\n` +
            `쓴 돈 ${won(CREATE_COST)}\n💰 현재 잔액 **${won(r.balance)}**\n🎒 보유 무기 ${r.count}/${MAX_WEAPONS}\n\n` +
            "아래 버튼으로 바로 강화해 보세요.",
        );
      await interaction.reply({
        embeds: [embed],
        components: [buttonRow(r.id, 0)],
      });
      return attachButtons(interaction, r.id);
    }

    if (sub === "랭킹") {
      return interaction.reply({
        embeds: [await rankingEmbed("weapon", interaction.guildId)],
        allowedMentions: { parse: [] },
      });
    }

    if (!stmtUser.get(userId)) return notRegistered(interaction);

    // 정보: 무기를 고르지 않았고 여러 개면 목록을 보여 준다
    if (sub === "정보" && !interaction.options.getString("무기")) {
      const list = stmtAll.all(userId);
      if (!list.length) return noWeapon(interaction);
      if (list.length > 1) {
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(
            `🎒 ${interaction.user.username}님의 무기 (${list.length}/${MAX_WEAPONS})`,
          )
          .setDescription(
            list
              .map(
                (w) =>
                  `**${label(w.name, w.level)}** · ${TIER_NAMES[w.level]}\n${levelBar(w.level)} +${w.level}/${MAX_LEVEL} · EXP ${w.exp.toLocaleString()}/${expNeed(w.level).toLocaleString()} · 판매가 ${won(SELL_PRICE[w.level])}`,
              )
              .join("\n\n"),
          )
          .setFooter({
            text: "한 무기의 자세한 정보와 강화 버튼은 `무기` 칸에 이름을 골라서 봐요",
          });
        return interaction.reply({ embeds: [embed] });
      }
    }

    const picked = findWeapon(userId, interaction.options.getString("무기"));
    const bad = pickError(interaction, picked);
    if (bad) return bad;
    const w = picked.weapon;

    if (sub === "강화") {
      const r = enhance(userId, w.id);
      if (r.error === "MAX_LEVEL")
        return interaction.reply({
          content: `**${w.name}**은 이미 최고 단계(+${MAX_LEVEL})예요! 팔아서 새 무기에 도전해 보세요.`,
          flags: EPHEMERAL,
        });
      if (r.error) return lackMoney(interaction, r.need);
      cache.invalidateMoney(userId);
      progress.record(userId, "weapon");
      progress.recordMax(userId, "weapon_best", r.level);
      await interaction.reply({
        embeds: [enhanceEmbed(userId, r)],
        components: [buttonRow(w.id, r.level)],
        allowedMentions: { parse: [] },
      });
      return attachButtons(interaction, w.id);
    }

    if (sub === "정보") {
      const next = STEPS[w.level];
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`⚔️ ${interaction.user.username}님의 무기`)
        .setDescription(
          `**${label(w.name, w.level)}** (${TIER_NAMES[w.level]})\n${levelBar(w.level)} +${w.level}/${MAX_LEVEL}\n` +
            `경험치: ${w.level >= MAX_LEVEL ? "최고 단계" : `${expBar(w.exp, w.level)} ${expText(w.exp, w.level)}`}`,
        )
        .addFields(
          { name: "판매가", value: won(SELL_PRICE[w.level]), inline: true },
          { name: "최고 기록", value: `+${w.best_level}`, inline: true },
          {
            name: "다음 강화",
            value: next
              ? `시도당 ${won(next[0])} · 성공 ${Math.round(next[1] * 100)}% (성공하면 ${EXP_GAIN[0]}~${EXP_GAIN[1]} EXP)${next[2] ? `\n실패하면 경험치 ${EXP_LOSS} 줄어요` : ""}`
              : "최고 단계예요!",
            inline: false,
          },
        );
      await interaction.reply({
        embeds: [embed],
        components: [buttonRow(w.id, w.level)],
      });
      return attachButtons(interaction, w.id);
    }

    // 판매
    const r = sell(userId, w.id);
    if (r.error) return noWeapon(interaction);
    cache.invalidateMoney(userId);
    return interaction.reply({ embeds: [sellEmbed(r)] });
  },
};
