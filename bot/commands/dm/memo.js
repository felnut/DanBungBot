const {
  SlashCommandBuilder,
  InteractionContextType,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database");

const MAX_PER_USER = 30;

const stmtCount = db.prepare(
  "SELECT COUNT(*) AS n FROM memo WHERE user_id = ?",
);
const stmtInsert = db.prepare(
  "INSERT INTO memo (user_id, content, created_at) VALUES (?, ?, ?)",
);
const stmtList = db.prepare(
  "SELECT id, content, created_at FROM memo WHERE user_id = ? ORDER BY id DESC LIMIT 25",
);
const stmtDelete = db.prepare("DELETE FROM memo WHERE id = ? AND user_id = ?");
const stmtClear = db.prepare("DELETE FROM memo WHERE user_id = ?");

const reply = (i, content) =>
  i.reply({ content, flags: MessageFlags.Ephemeral });

module.exports = {
  data: new SlashCommandBuilder()
    .setName("메모")
    .setDescription("나만 보는 메모장 (DM 전용)")
    .setContexts(InteractionContextType.BotDM)
    .addSubcommand((s) =>
      s
        .setName("추가")
        .setDescription("메모를 남겨요")
        .addStringOption((o) =>
          o
            .setName("내용")
            .setDescription(
              "메모 내용 (비밀번호 같은 민감한 정보는 적지 마세요)",
            )
            .setRequired(true)
            .setMaxLength(500),
        ),
    )
    .addSubcommand((s) =>
      s.setName("목록").setDescription("최근 메모 25개를 봐요"),
    )
    .addSubcommand((s) =>
      s
        .setName("삭제")
        .setDescription("메모를 지워요")
        .addIntegerOption((o) =>
          o
            .setName("번호")
            .setDescription("목록에 나온 번호")
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((s) =>
      s.setName("전체삭제").setDescription("내 메모를 모두 지워요"),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === "추가") {
      if (stmtCount.get(userId).n >= MAX_PER_USER)
        return reply(
          interaction,
          `메모는 ${MAX_PER_USER}개까지 남길 수 있어요. 안 쓰는 메모를 지워 주세요.`,
        );
      const id = stmtInsert.run(
        userId,
        interaction.options.getString("내용"),
        Date.now(),
      ).lastInsertRowid;
      return reply(interaction, `📝 메모 **#${id}**를 남겼어요.`);
    }

    if (sub === "목록") {
      const rows = stmtList.all(userId);
      const text = rows.length
        ? rows
            .map(
              (r) =>
                `**#${r.id}** · <t:${Math.floor(r.created_at / 1000)}:d>\n${r.content}`,
            )
            .join("\n\n")
            .slice(0, 4000)
        : "남겨 둔 메모가 없어요. `/메모 추가`로 남겨 보세요!";
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfee75c)
            .setTitle("📝 내 메모")
            .setDescription(text)
            .setFooter({
              text: "지울 때는 /메모 삭제 · 메모는 직접 지울 때까지 보관돼요",
            }),
        ],
      });
    }

    if (sub === "삭제") {
      const removed = stmtDelete.run(
        interaction.options.getInteger("번호"),
        userId,
      ).changes;
      return reply(
        interaction,
        removed
          ? "메모를 지웠어요."
          : "그 번호의 메모가 없어요. `/메모 목록`으로 번호를 확인해 주세요.",
      );
    }

    return reply(
      interaction,
      `메모 ${stmtClear.run(userId).changes}개를 모두 지웠어요.`,
    );
  },
};
