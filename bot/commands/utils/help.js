const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const EPHEMERAL = MessageFlags.Ephemeral;
const { SITE_URL: DOCS } = require("../../config"); // 이용약관·개인정보 처리방침이 있는 공식 웹사이트 주소

// 분류와 사용법 정리는 웹사이트와 함께 쓰는 공용 모듈(bot/commandInfo.js)에 있다
const { CATEGORIES, groupByCategory, usageOf } = require("../../commandInfo");

const isOwner = (interaction) =>
  Boolean(process.env.OWNER_ID) && interaction.user.id === process.env.OWNER_ID;

/** 지금 이 사용자에게 보여줄 명령어 [{name, json}] (봇 운영자 전용 명령어는 봇 운영자에게만) */
function visibleCommands(interaction) {
  const ownerOnly = new Set(
    CATEGORIES.filter((c) => c.ownerOnly).flatMap((c) => c.names),
  );
  const out = [];
  for (const cmd of interaction.client.commands.values()) {
    const json = cmd.data.toJSON();
    if (ownerOnly.has(json.name) && !isOwner(interaction)) continue;
    out.push({ name: json.name, json });
  }
  return out;
}

/** 한 명령어의 사용법 줄들 (하위 명령이 있으면 설명 한 줄 + 하위 명령마다 한 줄) */
function usageLines(json) {
  const { description, usages } = usageOf(json);
  const lines = usages.map((u) => `\`${u.syntax}\` — ${u.description}`);
  return usages.length > 1 ||
    json.options?.some((o) => o.type === 1 || o.type === 2)
    ? [description, ...lines]
    : lines;
}

const clip = (text, max) =>
  text.length > max ? text.slice(0, max - 1) + "…" : text;

const linkRow = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("이용약관")
      .setStyle(ButtonStyle.Link)
      .setURL(`${DOCS}/terms`),
    new ButtonBuilder()
      .setLabel("개인정보 처리방침")
      .setStyle(ButtonStyle.Link)
      .setURL(`${DOCS}/privacy`),
    new ButtonBuilder()
      .setLabel("소스 코드")
      .setStyle(ButtonStyle.Link)
      .setURL("https://github.com/felnut/OMNI-Bot"),
  );

function overview(groups) {
  const embed = new EmbedBuilder()
    .setColor("#5865f2")
    .setTitle("📖 OMNI 도움말")
    .setDescription(
      "분류별로 `/유틸 도움말 분류:음악`, 명령어별로 `/유틸 도움말 명령어:도박`처럼 쓰면 자세한 사용법을 볼 수 있어요.\n" +
        "`<이름>`은 꼭 입력해야 하는 칸, `[이름]`은 선택 칸이에요.",
    )
    .addFields(
      groups.map((g) => ({
        name: g.title,
        value: clip(g.commands.map((c) => `\`/${c.name}\``).join(" "), 1024),
      })),
    )
    .setFooter({ text: "문의: dev@felnut.com" });
  return { embeds: [embed], components: [linkRow()] };
}

function categoryDetail(group) {
  const embed = new EmbedBuilder()
    .setColor("#5865f2")
    .setTitle(`${group.title} 명령어`);
  let total = 0;
  let omitted = 0;
  for (const c of group.commands) {
    const value = clip(usageLines(c.json).join("\n"), 1000);
    if (total + value.length + c.name.length > 5200) {
      omitted += 1; // 임베드 전체 글자 수 제한(6000) 안에서만 보여준다
      continue;
    }
    total += value.length + c.name.length;
    embed.addFields({ name: `/${c.name}`, value });
  }
  if (omitted)
    embed.setFooter({
      text: `${omitted}개는 생략했어요. /도움말 명령어:이름 으로 보세요`,
    });
  return { embeds: [embed], components: [linkRow()] };
}

function commandDetail(command) {
  const embed = new EmbedBuilder()
    .setColor("#5865f2")
    .setTitle(`/${command.name}`)
    .setDescription(clip(usageLines(command.json).join("\n"), 4000));
  return { embeds: [embed], components: [linkRow()] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("도움말")
    .setDescription(
      "OMNI 명령어 안내 (분류나 명령어를 골라 자세히 볼 수 있어요)",
    )
    .addStringOption((o) =>
      o
        .setName("분류")
        .setDescription("분류별 명령어 보기")
        .addChoices(
          ...CATEGORIES.filter((c) => !c.ownerOnly).map((c) => ({
            name: c.title.replace(/^\S+\s/, ""),
            value: c.key,
          })),
        ),
    )
    .addStringOption((o) =>
      o
        .setName("명령어")
        .setDescription("명령어 하나의 사용법 보기 (예: 도박)")
        .setAutocomplete(true)
        .setMaxLength(30),
    ),

  // 명령어 이름 자동완성 (사용자에게 보이는 명령어만)
  async autocomplete(interaction) {
    const typed = String(interaction.options.getFocused() ?? "")
      .trim()
      .replace(/^\//, "");
    const choices = visibleCommands(interaction)
      .filter((c) => !typed || c.name.includes(typed))
      .slice(0, 25)
      .map((c) => ({
        name: `/${c.name} — ${clip(c.json.description, 60)}`.slice(0, 100),
        value: c.name,
      }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    const commands = visibleCommands(interaction);
    const wanted = interaction.options
      .getString("명령어")
      ?.trim()
      .replace(/^\//, "");
    const categoryKey = interaction.options.getString("분류");

    if (wanted) {
      const command = commands.find((c) => c.name === wanted);
      if (!command) {
        return interaction.reply({
          content: `❌ \`/${wanted}\` 명령어를 찾지 못했어요. \`/도움말\`로 전체 목록을 확인해 보세요.`,
          flags: EPHEMERAL,
        });
      }
      return interaction.reply({ ...commandDetail(command), flags: EPHEMERAL });
    }

    const groups = groupByCategory(commands);
    if (categoryKey) {
      const group = groups.find((g) => g.key === categoryKey);
      if (!group)
        return interaction.reply({
          content: "❌ 그 분류에는 보여줄 명령어가 없어요.",
          flags: EPHEMERAL,
        });
      return interaction.reply({ ...categoryDetail(group), flags: EPHEMERAL });
    }
    return interaction.reply({ ...overview(groups), flags: EPHEMERAL });
  },
};
