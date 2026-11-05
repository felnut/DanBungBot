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

const bar = (value, target) => {
  const filled = Math.round((value / target) * 8);
  return "▰".repeat(filled) + "▱".repeat(8 - filled);
};

function buildEmbed(userId, username, footer) {
  const quests = progress.questView(userId);
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`📋 ${username}님의 퀘스트`);
  for (const tier of ["일일", "주간", "월간"]) {
    const lines = quests
      .filter((q) => q.tier === tier)
      .map((q) => {
        const state = q.claimed ? "✅" : q.done ? "🎁" : "▫️";
        return `${state} **${q.text}** · ${q.progress}/${q.target} \`${bar(q.progress, q.target)}\`\n└ 보상 ${q.reward.toLocaleString()}원${q.claimed ? " (받음)" : q.done ? " · 받을 수 있어요!" : ""}`;
      });
    embed.addFields({ name: `${tier} 퀘스트`, value: lines.join("\n") });
  }
  const claimable = quests.some((q) => q.done && !q.claimed);
  embed.setFooter({
    text:
      footer ??
      "일일은 매일 0시, 주간은 월요일 0시, 월간은 매달 1일 0시에 새로 나와요",
  });
  return { embed, claimable };
}

const button = (disabled) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("quest:claim")
      .setLabel("보상 받기")
      .setEmoji("🎁")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  );

module.exports = {
  data: new SlashCommandBuilder()
    .setName("퀘스트")
    .setDescription("일일·주간·월간 퀘스트를 확인하고 보상을 받아요"),

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
      filter: (i) => i.user.id === userId && i.customId === "quest:claim",
      componentType: ComponentType.Button,
      time: 120_000,
    });
    collector.on("collect", async (i) => {
      const { count, total } = progress.claimQuests(userId);
      progress.invalidateMoney(userId);
      const view = buildEmbed(
        userId,
        interaction.user.username,
        count
          ? `🎉 퀘스트 ${count}개 보상 ${total.toLocaleString()}원을 받았어요!`
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
