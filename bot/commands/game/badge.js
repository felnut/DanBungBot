const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database");
const progress = require("../../managers/progress");

const NONE = "none";

function view(userId, username, footer) {
  const owned = progress.badgesOf(userId);
  const equipped = progress.equippedBadge(userId);
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(
      `🎖️ ${username}님의 배지 (${owned.length}/${progress.ACHIEVEMENTS.length})`,
    )
    .setDescription(
      (equipped
        ? `장착 중: ${equipped.icon} **${equipped.name}**\n\n`
        : "장착 중인 배지가 없어요.\n\n") +
        (owned.length
          ? owned.map((a) => `${a.icon} **${a.name}** — ${a.desc}`).join("\n")
          : "아직 배지가 없어요. `/게임 도전과제`에서 보상을 받으면 얻어요!"),
    )
    .setFooter({ text: footer ?? "장착한 배지는 /게임 정보에 보여요" });
  if (!owned.length) return { embed, components: [] };
  const menu = new StringSelectMenuBuilder()
    .setCustomId("badge:equip")
    .setPlaceholder("장착할 배지를 고르세요")
    .addOptions([
      ...owned
        .slice(0, 24)
        .map((a) => ({
          label: a.name,
          description: a.desc,
          emoji: a.icon,
          value: a.id,
          default: equipped?.id === a.id,
        })),
      { label: "장착 해제", emoji: "➖", value: NONE },
    ]);
  return { embed, components: [new ActionRowBuilder().addComponents(menu)] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("배지")
    .setDescription("모은 배지를 보고 프로필에 장착해요"),

  async execute(interaction) {
    const userId = interaction.user.id;
    if (!db.prepare("SELECT 1 FROM user WHERE user_id = ?").get(userId)) {
      return interaction.reply({
        content: "먼저 `/게임 가입`으로 가입해주세요!",
        flags: MessageFlags.Ephemeral,
      });
    }
    const first = view(userId, interaction.user.username);
    await interaction.reply({
      embeds: [first.embed],
      components: first.components,
      flags: MessageFlags.Ephemeral,
    });
    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
      filter: (i) => i.user.id === userId && i.customId === "badge:equip",
      componentType: ComponentType.StringSelect,
      time: 120_000,
    });
    collector.on("collect", async (i) => {
      const pick = i.values[0];
      const ok = progress.equipBadge(userId, pick === NONE ? null : pick);
      const next = view(
        userId,
        interaction.user.username,
        ok
          ? pick === NONE
            ? "배지를 해제했어요"
            : "배지를 장착했어요!"
          : "가지고 있지 않은 배지예요",
      );
      await i
        .update({ embeds: [next.embed], components: next.components })
        .catch(() => {});
    });
    collector.on("end", () =>
      interaction.editReply({ components: [] }).catch(() => {}),
    );
  },
};
