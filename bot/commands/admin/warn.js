const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database");
const mod = require("../../managers/moderation");

const EPHEMERAL = MessageFlags.Ephemeral;

const stmtAdd = db.prepare(
  "INSERT INTO warning (guild_id, user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?)",
);
const stmtCount = db.prepare(
  "SELECT COUNT(*) AS n FROM warning WHERE guild_id = ? AND user_id = ?",
);
const stmtList = db.prepare(
  "SELECT id, reason, moderator_id, created_at FROM warning WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 10",
);
const stmtLast = db.prepare(
  "SELECT id FROM warning WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1",
);
const stmtDel = db.prepare("DELETE FROM warning WHERE id = ?");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("경고")
    .setDescription(
      `유저 경고 관리 (${mod.AUTO_TIMEOUT_AT}회 누적마다 24시간 타임아웃) · 지급/차감은 서버 운영자 전용`,
    )
    // 기본 권한을 두지 않는다: 조회는 누구나 쓸 수 있고, 지급·차감은 실행할 때 서버 운영자급인지 확인한다
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("지급")
        .setDescription("경고 1회 주기")
        .addUserOption((o) =>
          o.setName("유저").setDescription("대상").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("사유").setDescription("사유").setMaxLength(200),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("차감")
        .setDescription("가장 최근 경고 1회 지우기")
        .addUserOption((o) =>
          o.setName("유저").setDescription("대상").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("조회")
        .setDescription("경고 내역 보기")
        .addUserOption((o) =>
          o.setName("유저").setDescription("대상").setRequired(true),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser("유저");
    const guildId = interaction.guildId;

    if (sub === "조회") {
      // 조회는 누구나 가능하되, 서버 운영자급이 아니면 본인 기록만 볼 수 있다
      if (!interaction.inGuild())
        return interaction.reply({
          content: "❌ 서버 안에서만 사용할 수 있어요.",
          flags: EPHEMERAL,
        });
      if (
        user.id !== interaction.user.id &&
        !mod.isServerManager(interaction)
      ) {
        return interaction.reply({
          content:
            "❌ 다른 사람의 경고는 서버 소유자 또는 서버 관리 권한이 있는 역할만 볼 수 있어요. 본인 경고는 조회할 수 있어요.",
          flags: EPHEMERAL,
        });
      }
    } else {
      const denied = mod.checkActor(interaction);
      if (denied)
        return interaction.reply({ content: denied, flags: EPHEMERAL });
    }

    if (sub === "조회") {
      const rows = stmtList.all(guildId, user.id);
      const total = stmtCount.get(guildId, user.id).n;
      const embed = new EmbedBuilder()
        .setColor("#e67e22")
        .setTitle(`⚠️ ${user.username}님의 경고 (${total}회)`)
        .setDescription(
          rows.length
            ? rows
                .map(
                  (r) =>
                    `\`#${r.id}\` <t:${Math.floor(r.created_at / 1000)}:d> · ${mod.reasonOf(r.reason)}`,
                )
                .join("\n")
            : "경고 내역이 없어요.",
        )
        .setFooter({
          text: "경고는 1년 뒤 자동으로 삭제돼요 · 최근 10건만 표시",
        });
      return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
    }

    if (sub === "차감") {
      const last = stmtLast.get(guildId, user.id);
      if (!last)
        return interaction.reply({
          content: "경고 내역이 없어요.",
          flags: EPHEMERAL,
        });
      stmtDel.run(last.id);
      await mod.sendModLog(interaction.guild, {
        action: "경고 차감",
        targetId: user.id,
        moderatorId: interaction.user.id,
        reason: "차감",
      });
      return interaction.reply({
        content: `✅ <@${user.id}> 님의 경고를 1회 줄였어요. (현재 ${stmtCount.get(guildId, user.id).n}회)`,
        allowedMentions: { parse: [] },
      });
    }

    // 지급
    const member = interaction.options.getMember("유저");
    const bad = mod.checkTarget(interaction, member, user);
    if (bad) return interaction.reply({ content: bad, flags: EPHEMERAL });
    if (user.bot)
      return interaction.reply({
        content: "❌ 봇에게는 줄 수 없어요.",
        flags: EPHEMERAL,
      });

    const reason = mod.reasonOf(interaction.options.getString("사유"));
    stmtAdd.run(guildId, user.id, interaction.user.id, reason, Date.now());
    const count = stmtCount.get(guildId, user.id).n;
    await mod.sendModLog(interaction.guild, {
      action: "경고",
      targetId: user.id,
      moderatorId: interaction.user.id,
      reason,
      extra: `누적 ${count}회`,
    });

    let note = "";
    if (count % mod.AUTO_TIMEOUT_AT === 0) {
      if (member?.moderatable) {
        try {
          await member.timeout(
            mod.AUTO_TIMEOUT_MS,
            `경고 ${count}회 누적 자동 타임아웃`,
          );
          note = `\n🔇 경고 ${count}회 누적으로 24시간 타임아웃했어요.`;
          await mod.sendModLog(interaction.guild, {
            action: "자동 타임아웃",
            targetId: user.id,
            moderatorId: interaction.client.user.id,
            reason: `경고 ${count}회 누적`,
            extra: "24시간",
          });
        } catch (e) {
          console.error("자동 타임아웃 오류:", e.message);
          note =
            "\n⚠️ 누적 기준에 도달했지만 자동 타임아웃에 실패했어요. (봇 권한 확인)";
        }
      } else {
        note = "\n⚠️ 누적 기준에 도달했지만 봇이 이 유저를 제한할 수 없어요.";
      }
    }
    return interaction.reply({
      content: `⚠️ <@${user.id}> 님에게 경고를 줬어요. (누적 ${count}회) — ${reason}${note}`,
      allowedMentions: { parse: [] },
    });
  },
};
