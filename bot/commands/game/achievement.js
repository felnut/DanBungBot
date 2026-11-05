const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database");
const progress = require("../../managers/progress");

function buildEmbed(userId, username, footer) {
  const list = progress.achievementView(userId);
  const claimedCount = list.filter((a) => a.claimed).length;
  const lines = list.map((a) => {
    const state = a.claimed ? "✅" : a.done ? "🎁" : "▫️";
    const prog =
      a.claimed || a.done
        ? ""
        : ` · ${a.value.toLocaleString()}/${a.target.toLocaleString()}`;
    return `${state} ${a.icon} **${a.name}** — ${a.desc}${prog} · ${a.reward.toLocaleString()}원${a.done && !a.claimed ? " · 받을 수 있어요!" : ""}`;
  });
  return {
    embed: new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`🏆 ${username}님의 도전과제 (${claimedCount}/${list.length})`)
      .setDescription(lines.join("\n"))
      .setFooter({
        text:
          footer ?? "보상을 받으면 배지를 얻어요 · /배지로 프로필에 장착해요",
      }),
    claimable: list.some((a) => a.done && !a.claimed),
  };
}

const button = (disabled) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ach:claim")
      .setLabel("보상 받기")
      .setEmoji("🎁")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  );

module.exports = {
  data: new SlashCommandBuilder()
    .setName("도전과제")
    .setDescription("도전과제 진행도를 보고 보상과 배지를 받아요"),

  async execute(interaction) {
    const userId = interaction.user.id;
    if (!db.prepare("SELECT 1 FROM user WHERE user_id = ?").get(userId)) {
      return interaction.reply({
        content: "먼저 `/게임 가입`으로 가입해주세요!",
        flags: MessageFlags.Ephemeral,
      });
    }
    const first = buildEmbed(userId, interaction.user.username);
    await interaction.reply({
      embeds: [first.embed],
      components: [button(!first.claimable)],
      flags: MessageFlags.Ephemeral,
    });
    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
      filter: (i) => i.user.id === userId && i.customId === "ach:claim",
      componentType: ComponentType.Button,
      time: 120_000,
    });
    collector.on("collect", async (i) => {
      const { items, total } = progress.claimAchievements(userId);
      progress.invalidateMoney(userId);
      const view = buildEmbed(
        userId,
        interaction.user.username,
        items.length
          ? `🎉 ${items.join(", ")} · ${total.toLocaleString()}원을 받았어요!`
          : "받을 수 있는 보상이 없어요",
      );
      await i
        .update({ embeds: [view.embed], components: [button(!view.claimable)] })
        .catch(() => {});
    });
    collector.on("end", () =>
      interaction.editReply({ components: [button(true)] }).catch(() => {}),
    );
  },
};
