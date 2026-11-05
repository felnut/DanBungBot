const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database");
const { getUserOrFail } = require("../utils/user");
const cache = require("../utils/cache");

const stmtSelectReceiver = db.prepare(
  "SELECT money FROM user WHERE user_id = ?",
);
const stmtUpdateMoneyDelta = db.prepare(
  "UPDATE user SET money = money + ? WHERE user_id = ?",
);

const DAILY_SEND_LIMIT = 30000; // 24시간 송금 한도
const stmtSentSince = db.prepare(
  "SELECT COALESCE(SUM(amount), 0) AS total FROM transfer_log WHERE sender_id = ? AND created_at >= ?",
);
const stmtLogTransfer = db.prepare(
  "INSERT INTO transfer_log (sender_id, receiver_id, amount, created_at) VALUES (?, ?, ?, ?)",
);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("송금")
    .setDescription("다른 유저에게 돈을 보냅니다 (24시간 최대 30,000원) 📤")
    .addUserOption((option) =>
      option.setName("유저").setDescription("돈을 보낼 유저").setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("금액")
        .setDescription("보낼 금액")
        .setRequired(true)
        .setMinValue(1),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser("유저");
    const amount = interaction.options.getInteger("금액");

    // 자기 자신에게 송금 금지
    if (target.id === interaction.user.id) {
      return interaction.reply({
        content: "자기 자신한테는 못 보내요 ㅠㅠ",
        flags: 64,
      });
    }
    // 봇에게 송금 금지
    if (target.bot) {
      return interaction.reply({
        content: "봇한테는 돈 못 보내요!",
        flags: 64,
      });
    }

    let sender;
    try {
      sender = getUserOrFail(interaction, amount); // 송금자 잔액 체크
    } catch (err) {
      const content =
        err.message === "NOT_REGISTERED"
          ? "먼저 `/게임 가입`으로 가입해주세요!"
          : `💸 돈이 부족해요! (필요: ${amount.toLocaleString()}원)`;
      return interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }

    // 받는 사람이 가입되어 있는지 확인
    const receiver = stmtSelectReceiver.get(target.id);
    if (!receiver) {
      return interaction.reply({
        content: `${target} 님은 아직 가입 안 했어요.\n상대방이 먼저 \`/게임 가입\` 쳐야 송금 가능해요!`,
        flags: 64,
      });
    }

    // 부계정으로 몰아주기 방지: 최근 24시간 송금 합계 한도
    const now = Date.now();
    const sentToday = stmtSentSince.get(
      sender.user_id,
      now - 24 * 60 * 60 * 1000,
    ).total;
    if (sentToday + amount > DAILY_SEND_LIMIT) {
      const left = Math.max(DAILY_SEND_LIMIT - sentToday, 0);
      return interaction.reply({
        content: `📛 송금은 24시간에 최대 ${DAILY_SEND_LIMIT.toLocaleString()}원까지예요. (지금 보낼 수 있는 금액: ${left.toLocaleString()}원)`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ====================== 실제 송금 처리 ======================
    const senderNewMoney = sender.money - amount;
    const receiverNewMoney = receiver.money + amount;

    if (senderNewMoney < 0) throw new Error("잔액 부족으로 송금 실패");

    const tx = db.transaction(() => {
      stmtUpdateMoneyDelta.run(-amount, sender.user_id);
      stmtUpdateMoneyDelta.run(amount, target.id);
      stmtLogTransfer.run(sender.user_id, target.id, amount, now);
    });
    tx();

    cache.invalidateMoney(sender.user_id, target.id);
    // 다른 계정에 보내면 비용이 들지 않으므로 100원 이상만 세고 하루 횟수도 제한한다 (progress.js)
    if (amount >= 100)
      require("../../managers/progress").record(sender.user_id, "transfer");

    const embed = new EmbedBuilder()
      .setColor("#3498db")
      .setTitle("✅ 송금 완료!")
      .setDescription(
        `${target}님께 **${amount.toLocaleString()} 원** 보냈어요 💸`,
      )
      .addFields(
        {
          name: "내 잔고",
          value: `**${senderNewMoney.toLocaleString()} 원**`,
          inline: true,
        },
        {
          name: "받는 사람 잔고",
          value: `**${receiverNewMoney.toLocaleString()} 원**`,
          inline: true,
        },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
