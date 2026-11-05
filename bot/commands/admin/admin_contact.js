const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const db = require("../../../Database.js");
const { isServerManager } = require("../utils/perm");
const { SITE_URL } = require("../../config");

const EMAIL_RE =
  /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const EPHEMERAL = MessageFlags.Ephemeral;

const stmtUpsert = db.prepare(`
  INSERT INTO admin_contact (guild_id, user_id, email, consented_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at
`);
const stmtGet = db.prepare(
  "SELECT email, consented_at FROM admin_contact WHERE guild_id = ? AND user_id = ?",
);
const stmtDelete = db.prepare(
  "DELETE FROM admin_contact WHERE guild_id = ? AND user_id = ?",
);

/** 이메일 일부를 가려서 표시 (예: ab***@gmail.com) */
function maskEmail(email) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("관리자")
    .setDescription(
      "서버 운영자 연락처 등록 (운영 공지 수동 안내용) · 등록은 서버 운영자 전용",
    )
    // 기본 권한을 두지 않는다: 확인·해제는 본인 기록만 다루므로 누구나, 등록은 실행할 때 서버 운영자급인지 확인한다
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("등록")
        .setDescription(
          "관리자 이메일 등록·변경 (운영 공지 수동 안내용, 안내 확인 후 동의 버튼으로 등록)",
        )
        .addStringOption((opt) =>
          opt
            .setName("이메일")
            .setDescription("공지를 받을 이메일 주소")
            .setRequired(true)
            .setMaxLength(254),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("확인").setDescription("내가 등록한 연락처 확인 (일부 가림)"),
    )
    .addSubcommand((sub) =>
      sub.setName("해제").setDescription("등록한 이메일 즉시 삭제"),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "❌ 서버 안에서만 사용할 수 있어요.",
        flags: EPHEMERAL,
      });
    }
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const sub = interaction.options.getSubcommand();
    // 등록만 서버 운영자급에게 허용한다. 확인·해제는 자기 자신의 기록만 다루므로 누구나 쓸 수 있다
    // (역할이 바뀐 뒤에도 본인이 등록한 이메일을 언제든 삭제·철회할 수 있어야 하기 때문)
    if (sub === "등록" && !isServerManager(interaction)) {
      return interaction.reply({
        content:
          "❌ 서버 소유자 또는 서버 관리 권한이 있는 역할만 사용할 수 있어요.",
        flags: EPHEMERAL,
      });
    }

    if (sub === "등록") {
      const email = interaction.options
        .getString("이메일")
        .trim()
        .toLowerCase();
      if (!EMAIL_RE.test(email) || email.length > 254) {
        return interaction.reply({
          content: "❌ 이메일 형식이 올바르지 않아요.",
          flags: EPHEMERAL,
        });
      }
      // 저장 전에 수집·이용 내용을 알리고, 버튼으로 명확히 동의한 경우에만 저장한다
      const reply = await interaction.reply({
        content:
          `📧 \`${maskEmail(email)}\` 을(를) 등록할까요? 아래 내용을 확인하고 동의하면 저장합니다.\n` +
          "• **목적**: 봇 운영 공지(점검·정책 변경·초기화 등) 안내\n" +
          "• **항목**: 이메일 주소, 서버 ID, 등록자 ID, 동의·수정 시각\n" +
          "• **보유 기간**: 등록 해제(`/관리자 해제`) 또는 동의 철회 시까지\n" +
          "• 제3자에게 제공하지 않으며, 동의하지 않아도 다른 기능은 그대로 쓸 수 있어요(공지 이메일만 받지 못해요).\n" +
          `• 자세한 내용: ${SITE_URL}/privacy`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("admin_contact:agree")
              .setLabel("동의하고 등록")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId("admin_contact:cancel")
              .setLabel("취소")
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
        flags: EPHEMERAL,
        fetchReply: true,
      });
      try {
        const click = await reply.awaitMessageComponent({
          componentType: ComponentType.Button,
          filter: (i) => i.user.id === userId,
          time: 60_000,
        });
        if (click.customId !== "admin_contact:agree") {
          return click.update({
            content: "등록을 취소했어요. 저장된 정보는 없어요.",
            components: [],
          });
        }
        const now = Date.now();
        stmtUpsert.run(guildId, userId, email, now, now);
        return click.update({
          content: `✅ 동의를 확인하고 등록했어요: \`${maskEmail(email)}\`\n\`/관리자 해제\`로 언제든 삭제할 수 있고, 삭제 요청은 dev@felnut.com으로도 가능해요.`,
          components: [],
        });
      } catch {
        // 시간 초과: 아무것도 저장하지 않는다
        return interaction
          .editReply({
            content: "시간이 지나 등록하지 않았어요. 저장된 정보는 없어요.",
            components: [],
          })
          .catch(() => {});
      }
    }

    if (sub === "확인") {
      const row = stmtGet.get(guildId, userId);
      if (!row)
        return interaction.reply({
          content: "등록된 연락처가 없어요.",
          flags: EPHEMERAL,
        });
      return interaction.reply({
        content: `📧 \`${maskEmail(row.email)}\` (동의: <t:${Math.floor(row.consented_at / 1000)}:F>)`,
        flags: EPHEMERAL,
      });
    }

    // 해제
    const removed = stmtDelete.run(guildId, userId).changes;
    return interaction.reply({
      content: removed
        ? "🗑️ 등록한 이메일을 삭제했어요."
        : "등록된 연락처가 없어요.",
      flags: EPHEMERAL,
    });
  },
};
