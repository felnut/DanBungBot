const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database");
const progress = require("../../managers/progress");
const { FISH } = require("../../managers/fishData");

const stmtUser = db.prepare("SELECT money, streak FROM user WHERE user_id = ?");
const stmtRank = db.prepare(
  "SELECT COUNT(*) + 1 AS rank FROM user WHERE money > ?",
);
const stmtWeapon = db.prepare(
  "SELECT COUNT(*) AS n, MAX(level) AS top FROM weapons WHERE user_id = ?",
);
const stmtFishKinds = db.prepare(
  "SELECT COUNT(*) AS n FROM fish_log WHERE user_id = ? AND count > 0",
);
const stmtRealized = db.prepare(
  "SELECT profit FROM stock_realized WHERE user_id = ?",
);
const stmtStock = db.prepare(
  "SELECT COALESCE(SUM(us.shares * s.price), 0) AS v FROM user_stocks us JOIN stocks s ON s.symbol = us.symbol WHERE us.user_id = ?",
);
const stmtStat = db.prepare("SELECT key, value FROM stat WHERE user_id = ?");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("프로필")
    .setDescription("내 게임 프로필(자산·기록·배지)을 봐요")
    .addUserOption((o) =>
      o.setName("유저").setDescription("비워 두면 내 프로필"),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser("유저") ?? interaction.user;
    const user = stmtUser.get(target.id);
    if (!user) {
      const who =
        target.id === interaction.user.id
          ? "먼저 `/게임 가입`으로 가입해주세요!"
          : "아직 가입하지 않은 유저예요.";
      return interaction.reply({ content: who, flags: MessageFlags.Ephemeral });
    }
    const badge = progress.equippedBadge(target.id);
    const stats = new Map(stmtStat.all(target.id).map((r) => [r.key, r.value]));
    const weapon = stmtWeapon.get(target.id);
    const ach = progress.achievementView(target.id);
    const profit = stmtRealized.get(target.id)?.profit ?? 0;
    const stockValue = Math.round(stmtStock.get(target.id).v);

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`${badge ? `${badge.icon} ` : ""}${target.username}님의 프로필`)
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        {
          name: "💰 보유 금액",
          value: `${user.money.toLocaleString()}원`,
          inline: true,
        },
        {
          name: "🏅 전체 순위",
          value: `${stmtRank.get(user.money).rank.toLocaleString()}위`,
          inline: true,
        },
        { name: "🔥 연속 출석", value: `${user.streak || 0}일`, inline: true },
        {
          name: "📈 주식",
          value: `평가액 ${stockValue.toLocaleString()}원\n실현 수익 ${profit >= 0 ? "+" : ""}${profit.toLocaleString()}원`,
          inline: true,
        },
        {
          name: "⚔️ 무기",
          value: weapon.n ? `${weapon.n}개 (최고 +${weapon.top})` : "없음",
          inline: true,
        },
        {
          name: "📖 낚시 도감",
          value: `${stmtFishKinds.get(target.id).n}/${FISH.length}종`,
          inline: true,
        },
        {
          name: "🎮 미니게임",
          value: `${(stats.get("play") ?? 0).toLocaleString()}판`,
          inline: true,
        },
        {
          name: "🏆 도전과제",
          value: `${ach.filter((a) => a.claimed).length}/${ach.length}`,
          inline: true,
        },
        {
          name: "🎖️ 장착 배지",
          value: badge ? `${badge.icon} ${badge.name}` : "없음",
          inline: true,
        },
      )
      .setFooter({ text: "퀘스트 /퀘스트 · 도전과제 /도전과제 · 배지 /배지" });
    return interaction.reply({ embeds: [embed] });
  },
};
