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
const bets = require("../../managers/bets");
const bj = require("../../managers/blackjackLogic");

const MIN_BET = 100;
const MAX_BET = 100000;
const IDLE_MS = 60 * 1000; // 아무 입력이 없으면 자동으로 스탠드

const show = (hand) => hand.map(bj.label).join(" ");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("블랙잭")
    .setDescription(
      `21에 가까운 쪽이 이겨요! (베팅 ${MIN_BET.toLocaleString()}~${MAX_BET.toLocaleString()}원, 승리금 수수료 3%)`,
    )
    .addIntegerOption((o) =>
      o
        .setName("금액")
        .setDescription("베팅할 금액")
        .setRequired(true)
        .setMinValue(MIN_BET)
        .setMaxValue(MAX_BET),
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const bet = interaction.options.getInteger("금액");

    const user = db
      .prepare("SELECT money FROM user WHERE user_id = ?")
      .get(userId);
    if (!user)
      return interaction.reply({
        content: "먼저 `/게임 가입`으로 가입해주세요!",
        flags: MessageFlags.Ephemeral,
      });
    if (bets.hasPending(userId)) {
      return interaction.reply({
        content: "이미 진행 중인 게임이 있어요. 먼저 끝내 주세요!",
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!bets.startBet(userId, bet, "blackjack")) {
      return interaction.reply({
        content: `💸 돈이 부족해요! (필요: ${bet.toLocaleString()}원)`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const shoe = bj.newShoe();
    const player = [shoe.pop(), shoe.pop()];
    const dealer = [shoe.pop(), shoe.pop()];
    let finished = false;

    const buttons = (disabled = false) =>
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("bj:hit")
          .setLabel("히트")
          .setEmoji("🃏")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId("bj:stand")
          .setLabel("스탠드")
          .setEmoji("✋")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
      );

    const playingEmbed = () =>
      new EmbedBuilder()
        .setColor("#2b6cb0")
        .setTitle("🃏 블랙잭")
        .addFields(
          {
            name: `내 카드 (${bj.handValue(player).total})`,
            value: show(player),
          },
          { name: "딜러 카드", value: `${bj.label(dealer[0])} ❓` },
          { name: "베팅", value: `${bet.toLocaleString()}원`, inline: true },
        )
        .setFooter({
          text: "히트: 한 장 더 / 스탠드: 멈추기 · 60초 동안 입력이 없으면 자동으로 멈춰요",
        });

    /** 딜러 진행 → 정산 → 결과 메시지 */
    const finish = async (note) => {
      if (finished) return null;
      finished = true;
      if (bj.handValue(player).total <= 21 && !bj.isBlackjack(player))
        bj.dealerPlay(shoe, dealer);
      const res = bj.settle(player, dealer);
      const payout = bj.payoutOf(bet, res.mult);
      bets.settleBet(userId, payout);
      const money =
        db.prepare("SELECT money FROM user WHERE user_id = ?").get(userId)
          ?.money ?? 0;
      const net = payout - bet;
      return new EmbedBuilder()
        .setColor(
          res.result === "win"
            ? "#57f287"
            : res.result === "push"
              ? "#f1c40f"
              : "#ed4245",
        )
        .setTitle(
          res.result === "win"
            ? "🎉 승리!"
            : res.result === "push"
              ? "😐 무승부"
              : "😢 패배",
        )
        .setDescription(`${res.reason}${note ? ` (${note})` : ""}`)
        .addFields(
          {
            name: `내 카드 (${bj.handValue(player).total})`,
            value: show(player),
          },
          {
            name: `딜러 카드 (${bj.handValue(dealer).total})`,
            value: show(dealer),
          },
          {
            name: "손익",
            value: `${net >= 0 ? "+" : ""}${net.toLocaleString()}원`,
            inline: true,
          },
          {
            name: "💰 현재 잔액",
            value: `${money.toLocaleString()}원`,
            inline: true,
          },
        )
        .setTimestamp();
    };

    // 처음부터 블랙잭이면 바로 끝
    if (bj.isBlackjack(player) || bj.isBlackjack(dealer)) {
      return interaction.reply({ embeds: [await finish()] });
    }

    await interaction.reply({
      embeds: [playingEmbed()],
      components: [buttons()],
    });
    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      idle: IDLE_MS,
      filter: (i) => {
        if (i.user.id === userId) return true;
        i.reply({
          content: "내 게임이 아니에요!",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return false;
      },
    });

    collector.on("collect", async (i) => {
      try {
        if (i.customId === "bj:hit") {
          player.push(shoe.pop());
          const v = bj.handValue(player).total;
          if (v < 21)
            return await i.update({
              embeds: [playingEmbed()],
              components: [buttons()],
            });
        }
        const embed = await finish();
        if (embed) await i.update({ embeds: [embed], components: [] });
        collector.stop("done");
      } catch (e) {
        console.error("블랙잭 오류:", e.message);
      }
    });

    collector.on("end", async (_c, reason) => {
      if (finished) return;
      const embed = await finish(
        reason === "idle" ? "시간 초과로 자동 스탠드" : "자동 스탠드",
      );
      if (embed)
        await interaction
          .editReply({ embeds: [embed], components: [] })
          .catch(() => {});
    });
  },
};
