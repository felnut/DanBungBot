const {
  SlashCommandBuilder,
  InteractionContextType,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database");

const MAX_PER_USER = 10;
const MIN_MS = 60 * 1000;
const MAX_MS = 30 * 24 * 60 * 60 * 1000;
const UNIT_MS = { 일: 86400e3, 시간: 3600e3, 분: 60e3 };

/** "30분", "2시간 30분", "1일 3시간" 같은 문장을 밀리초로. 읽을 수 없으면 null */
function parseDuration(text) {
  const s = text.replace(/\s+/g, "");
  if (!s || !/^(\d+(일|시간|분))+$/.test(s)) return null;
  let ms = 0;
  for (const [, n, unit] of s.matchAll(/(\d+)(일|시간|분)/g))
    ms += Number(n) * UNIT_MS[unit];
  return ms;
}

const stmtCount = db.prepare(
  "SELECT COUNT(*) AS n FROM reminder WHERE user_id = ?",
);
const stmtInsert = db.prepare(
  "INSERT INTO reminder (user_id, message, due_at, created_at) VALUES (?, ?, ?, ?)",
);
const stmtList = db.prepare(
  "SELECT id, message, due_at FROM reminder WHERE user_id = ? ORDER BY due_at ASC",
);
const stmtDelete = db.prepare(
  "DELETE FROM reminder WHERE id = ? AND user_id = ?",
);

const reply = (i, content) =>
  i.reply({ content, flags: MessageFlags.Ephemeral });

module.exports = {
  parseDuration,
  data: new SlashCommandBuilder()
    .setName("알림")
    .setDescription("정해 둔 시간에 DM으로 알려 드려요 (DM 전용)")
    .setContexts(InteractionContextType.BotDM)
    .addSubcommand((s) =>
      s
        .setName("추가")
        .setDescription("알림을 맞춰요")
        .addStringOption((o) =>
          o
            .setName("시간")
            .setDescription("지금부터 얼마 뒤인지 (예: 30분, 2시간 30분, 1일)")
            .setRequired(true)
            .setMaxLength(20),
        )
        .addStringOption((o) =>
          o
            .setName("내용")
            .setDescription("알려 줄 내용")
            .setRequired(true)
            .setMaxLength(200),
        ),
    )
    .addSubcommand((s) =>
      s.setName("목록").setDescription("맞춰 둔 알림을 봐요"),
    )
    .addSubcommand((s) =>
      s
        .setName("취소")
        .setDescription("알림을 취소해요")
        .addIntegerOption((o) =>
          o
            .setName("번호")
            .setDescription("목록에 나온 번호")
            .setRequired(true)
            .setMinValue(1),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === "추가") {
      const ms = parseDuration(interaction.options.getString("시간"));
      if (ms === null)
        return reply(
          interaction,
          "시간을 읽지 못했어요. `30분`, `2시간 30분`, `1일 3시간`처럼 써 주세요.",
        );
      if (ms < MIN_MS)
        return reply(interaction, "알림은 1분 뒤부터 맞출 수 있어요.");
      if (ms > MAX_MS)
        return reply(interaction, "알림은 최대 30일 뒤까지 맞출 수 있어요.");
      if (stmtCount.get(userId).n >= MAX_PER_USER)
        return reply(
          interaction,
          `알림은 ${MAX_PER_USER}개까지 맞춰 둘 수 있어요. 지나간 알림은 자동으로 사라져요.`,
        );
      const now = Date.now();
      const message = interaction.options.getString("내용");
      stmtInsert.run(userId, message, now + ms, now);
      const due = Math.floor((now + ms) / 1000);
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("⏰ 알림을 맞췄어요")
            .setDescription(`<t:${due}:F> (<t:${due}:R>)\n${message}`)
            .setFooter({ text: "DM이 막혀 있으면 알림을 받지 못해요" }),
        ],
      });
    }

    if (sub === "목록") {
      const rows = stmtList.all(userId);
      const text = rows.length
        ? rows
            .map(
              (r) =>
                `**#${r.id}** <t:${Math.floor(r.due_at / 1000)}:R> · ${r.message}`,
            )
            .join("\n")
        : "맞춰 둔 알림이 없어요. `/알림 추가`로 만들어 보세요!";
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("⏰ 내 알림")
            .setDescription(text),
        ],
      });
    }

    const removed = stmtDelete.run(
      interaction.options.getInteger("번호"),
      userId,
    ).changes;
    return reply(
      interaction,
      removed
        ? "알림을 취소했어요."
        : "그 번호의 알림이 없어요. `/알림 목록`으로 번호를 확인해 주세요.",
    );
  },
};
