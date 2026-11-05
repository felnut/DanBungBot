// 랭킹 화면 공통: 전체 TOP 5와 (켜져 있으면) 이 서버 TOP 5를 한 화면에 보여 준다.
// 서버 순위는 서버별 이용 기록(user_guild)이 필요한데, 이 기록은 개인정보 처리방침 개정본 시행 후에 켜므로
// GUILD_RANK_ENABLED가 꺼져 있으면 전체 순위만 보여 준다.
const { EmbedBuilder } = require("discord.js");
const db = require("../../Database");
const cache = require("../commands/utils/cache");
const { GUILD_RANK_ENABLED } = require("../config");
const { levelBar } = require("./weaponData");

const TOP = 5;
const MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

// 종류마다 [정렬·값 계산 SQL 조각]. 서버 순위는 같은 SQL에 user_guild를 합친다.
// 각 SELECT는 user_id와 value(보여 줄 값 문자열을 만들 재료)를 돌려준다.
const BOARDS = {
  money: {
    title: "💰 돈 랭킹",
    select:
      "SELECT u.user_id, u.money AS v1, 0 AS v2 FROM user u {JOIN} {WHERE} ORDER BY u.money DESC",
    line: (r) => `**${r.v1.toLocaleString()}원**`,
  },
  weapon: {
    title: "⚔️ 무기 랭킹",
    select:
      "SELECT u.user_id, MAX(w.level) AS v1, w.best_level AS v2, w.name AS v3 FROM weapons w JOIN user u ON u.user_id = w.user_id {JOIN} {WHERE} GROUP BY u.user_id ORDER BY v1 DESC, v2 DESC",
    line: (r) => `**${r.v3} +${r.v1}** (최고 +${r.v2})\n${levelBar(r.v1)}`,
  },
  stock: {
    title: "📈 주식 보유액 랭킹",
    select:
      "SELECT u.user_id, CAST(SUM(us.shares * s.price) AS INTEGER) AS v1, 0 AS v2 FROM user u JOIN user_stocks us ON us.user_id = u.user_id JOIN stocks s ON s.symbol = us.symbol {JOIN} {WHERE} GROUP BY u.user_id HAVING v1 > 0 ORDER BY v1 DESC",
    line: (r) => `**${r.v1.toLocaleString()}원**`,
  },
  fishing: {
    title: "🎣 낚시 랭킹",
    select:
      "SELECT u.user_id, COUNT(*) AS v1, SUM(f.count) AS v2 FROM fish_log f JOIN user u ON u.user_id = f.user_id {JOIN} {WHERE} GROUP BY u.user_id ORDER BY v1 DESC, v2 DESC",
    line: (r) => `도감 **${r.v1}종** · ${r.v2.toLocaleString()}마리`,
  },
};

const compiled = {};
function statements(kind) {
  if (!compiled[kind]) {
    const b = BOARDS[kind];
    compiled[kind] = {
      global: db.prepare(
        `${b.select.replace("{JOIN}", "").replace("{WHERE}", "")} LIMIT ${TOP}`,
      ),
      guild: db.prepare(
        `${b.select.replace("{JOIN}", "JOIN user_guild g ON g.user_id = u.user_id").replace("{WHERE}", "WHERE g.guild_id = ?")} LIMIT ${TOP}`,
      ),
    };
  }
  return compiled[kind];
}

const render = (rows, kind) =>
  rows.length
    ? rows
        .map((r, i) => `${MEDALS[i]} <@${r.user_id}> ${BOARDS[kind].line(r)}`)
        .join("\n")
    : "아직 순위에 오른 사람이 없어요.";

/** 랭킹 화면(임베드). kind: money / weapon / stock / fishing */
async function rankingEmbed(kind, guildId) {
  const st = statements(kind);
  const global = await cache.getOrSet(`rank5:${kind}:global`, 15000, async () =>
    st.global.all(),
  );
  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle(`🏆 ${BOARDS[kind].title} TOP ${TOP}`)
    .setTimestamp();
  embed.addFields({ name: "🌐 전체", value: render(global, kind) });
  if (GUILD_RANK_ENABLED && guildId) {
    const guild = await cache.getOrSet(
      `rank5:${kind}:guild:${guildId}`,
      15000,
      async () => st.guild.all(guildId),
    );
    embed.addFields({ name: "🏠 이 서버", value: render(guild, kind) });
  } else if (!GUILD_RANK_ENABLED) {
    embed.setFooter({
      text: "이 서버 순위는 서버별 이용 기록 기능이 켜지면 함께 보여요",
    });
  }
  return embed;
}

module.exports = { rankingEmbed, TOP };
