const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const db = require("../../../Database.js");

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const EPHEMERAL = MessageFlags.Ephemeral;

const stmtUpsert = db.prepare(`
  INSERT INTO admin_contact (guild_id, user_id, email, consented_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at
`);
const stmtGet = db.prepare("SELECT email, consented_at FROM admin_contact WHERE guild_id = ? AND user_id = ?");
const stmtDelete = db.prepare("DELETE FROM admin_contact WHERE guild_id = ? AND user_id = ?");

/** 이메일 일부를 가려서 표시 (예: ab***@gmail.com) */
function maskEmail(email) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

/** 서버 소유자 또는 관리자(Administrator) 권한자인지 */
function isServerAdmin(interaction) {
  return (
    interaction.guild?.ownerId === interaction.user.id ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("관리자")
    .setDescription("서버 관리자 연락처 등록 (운영 공지 수동 안내용)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("등록")
        .setDescription("관리자 이메일 등록·변경 (운영 공지 수동 안내용, 등록 시 수집·이용에 동의로 봄)")
        .addStringOption((opt) =>
          opt.setName("이메일").setDescription("공지를 받을 이메일 주소").setRequired(true).setMaxLength(254),
        ),
    )
    .addSubcommand((sub) => sub.setName("확인").setDescription("내가 등록한 연락처 확인 (일부 가림)"))
    .addSubcommand((sub) => sub.setName("해제").setDescription("등록한 이메일 즉시 삭제")),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "❌ 서버 안에서만 사용할 수 있어요.", flags: EPHEMERAL });
    }
    if (!isServerAdmin(interaction)) {
      return interaction.reply({ content: "❌ 서버 소유자 또는 관리자 권한이 있는 분만 사용할 수 있어요.", flags: EPHEMERAL });
    }

    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const sub = interaction.options.getSubcommand();

    if (sub === "등록") {
      const email = interaction.options.getString("이메일").trim().toLowerCase();
      if (!EMAIL_RE.test(email) || email.length > 254) {
        return interaction.reply({ content: "❌ 이메일 형식이 올바르지 않아요.", flags: EPHEMERAL });
      }
      const now = Date.now();
      stmtUpsert.run(guildId, userId, email, now, now);
      return interaction.reply({
        content:
          `✅ 등록했어요: \`${maskEmail(email)}\`\n` +
          "• 등록하면 아래 내용에 동의한 것으로 봅니다.\n" +
          "• **목적**: 봇 운영 공지(점검·정책 변경·초기화 등) 안내\n" +
          "• 제3자에게 제공하지 않습니다.\n" +
          "• `/관리자 해제`로 즉시 삭제할 수 있고, 삭제 요청은 dev@felnut.com으로도 가능합니다.\n" +
          "• 자세한 내용: https://felnut.github.io/DanBungBot/privacy",
        flags: EPHEMERAL,
      });
    }

    if (sub === "확인") {
      const row = stmtGet.get(guildId, userId);
      if (!row) return interaction.reply({ content: "등록된 연락처가 없어요.", flags: EPHEMERAL });
      return interaction.reply({
        content: `📧 \`${maskEmail(row.email)}\` (동의: <t:${Math.floor(row.consented_at / 1000)}:F>)`,
        flags: EPHEMERAL,
      });
    }

    // 해제
    const removed = stmtDelete.run(guildId, userId).changes;
    return interaction.reply({
      content: removed ? "🗑️ 등록한 이메일을 삭제했어요." : "등록된 연락처가 없어요.",
      flags: EPHEMERAL,
    });
  },
};
