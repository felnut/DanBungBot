const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database");
const { getUserOrFail } = require("../utils/user");
const cache = require("../utils/cache");

// 당첨 구성표 [금액, 확률]. 기대 당첨금 ≈ 493원 (복권값 500원 → 환수율 약 98.6%, 하우스 엣지 약 1.4%)
// 손실(<500원) 52% / 본전(500원) 12% / 이익(>500원) 36% → 잃고 얻는 빈도가 균형을 이룸
const LOTTO_TABLE = [
  [200, 0.32],
  [300, 0.2],
  [500, 0.12],
  [600, 0.15],
  [700, 0.067],
  [800, 0.09],
  [1200, 0.04],
  [2500, 0.01],
  [6000, 0.0025],
  [20000, 0.0004],
  [50000, 0.00008],
];
const LOTTO_TOTAL = LOTTO_TABLE.reduce((sum, [, p]) => sum + p, 0);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("복권")
    .setDescription("500원으로 복권을 구매합니다. (200~50,000원 당첨)"),

  async execute(interaction) {
    await interaction.deferReply();

    const useFee = 500; // 복권 가격

    let user;
    try {
      user = getUserOrFail(interaction, useFee);
    } catch (err) {
      const content =
        err.message === "NOT_REGISTERED"
          ? "먼저 `/돈`으로 가입해주세요!"
          : `💸 돈이 부족해요! (500원 필요)`;
      return interaction.editReply({ content, flags: MessageFlags.Ephemeral });
    }

    // 500원 차감
    db.prepare("UPDATE user SET money = money - ? WHERE user_id = ?").run(
      useFee,
      user.user_id,
    );
    user.money -= useFee;
    cache.del(`leaderboard:money:myRank:${user.user_id}`);
    cache.del("leaderboard:money:top10");

    // ==================== 당첨금 뽑기 (가중치 적용) ====================
    // 낮은 금액이 더 잘 나오게 설계된 가중치 랜덤
    let rand = Math.random() * LOTTO_TOTAL;
    let prize = LOTTO_TABLE[0][0];

    for (const [amount, p] of LOTTO_TABLE) {
      rand -= p;
      if (rand <= 0) {
        prize = amount;
        break;
      }
    }

    // 구매 완료 화면 (긁기 버튼)
    const buyEmbed = new EmbedBuilder()
      .setTitle("🎫 복권 구매 완료!")
      .setColor("#FFD700")
      .setDescription("버튼 눌러서 복권 긁어보세요!\n낮은 금액이 더 잘 나와요~ (200 ~ 50,000원)")
      .addFields(
        {
          name: "🧾 결제",
          value: `500원 차감\n잔액: **${user.money.toLocaleString()}원**`,
          inline: true,
        },
        { name: "⏰ 제한시간", value: "60초 안에 클릭!", inline: true },
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("draw_lotto")
        .setLabel("복권 긁기 🎟️")
        .setStyle(ButtonStyle.Primary),
    );

    await interaction.editReply({ embeds: [buyEmbed], components: [row] });

    const message = await interaction.fetchReply();

    // 버튼 대기 (60초 제한)
    const filter = (i) => i.user.id === interaction.user.id;
    const collector = message.createMessageComponentCollector({
      filter,
      componentType: ComponentType.Button,
      time: 60000,
    });

    let claimed = false; // 중복 클릭으로 당첨금이 두 번 지급되는 것 방지
    collector.on("collect", async (i) => {
      if (claimed) return;
      claimed = true;
      await i.deferUpdate();

      // 당첨금 지급
      db.prepare("UPDATE user SET money = money + ? WHERE user_id = ?").run(
        prize,
        user.user_id,
      );
      const newMoney = user.money + prize;
      cache.del(`leaderboard:money:myRank:${user.user_id}`);
      cache.del("leaderboard:money:top10");

      const resultEmbed = new EmbedBuilder()
        .setTitle("💰 당첨 결과!")
        .setColor(prize >= 10000 ? "#00FF88" : prize >= 500 ? "#88DDFF" : "#AAAAAA")
        .setDescription(`🎉 **${prize.toLocaleString()}원** 당첨!! 축하해요!`)
        .addFields({
          name: "현재 잔액",
          value: `**${newMoney.toLocaleString()} 원**`,
          inline: false,
        })
        .setTimestamp();

      await message.edit({ embeds: [resultEmbed], components: [] });
      collector.stop();
    });

    // 시간 초과 시 환불
    collector.on("end", async (collected, reason) => {
      if (reason === "time" && !claimed) {
        db.prepare("UPDATE user SET money = money + ? WHERE user_id = ?").run(
          useFee,
          user.user_id,
        );
        cache.del(`leaderboard:money:myRank:${user.user_id}`);
        cache.del("leaderboard:money:top10");
        await interaction.editReply({
          content: "시간이 지나서 취소됐어요~ 500원은 다시 돌려드렸습니다!",
          embeds: [],
          components: [],
        });
      }
    });
  },
};
