const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { isServerManager } = require("../utils/perm");
const {
  parseSource,
  SourceError,
  SUPPORTED_TEXT,
} = require("../../managers/recommendSources");
const rec = require("../../managers/musicRecommend");

const EPHEMERAL = MessageFlags.Ephemeral;
const GET_COOLDOWN_MS = 5000; // 서버당 5초에 한 번 (외부 사이트 요청을 아끼기 위해)
const lastGet = new Map(); // guildId -> 시각

const MANAGER_ONLY = new Set(["자동", "사이트추가", "사이트삭제"]);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("음악추천")
    .setDescription(
      "서버 운영자가 정한 음악 사이트(없으면 기본 차트)를 기준으로 곡을 추천받아요 · 설정은 서버 운영자 전용",
    )
    .setDMPermission(false)
    // 기본 권한을 두지 않는다: 받기·상태는 누구나, 자동·사이트추가·사이트삭제는 실행할 때 서버 운영자급인지 확인한다
    .addSubcommand((s) =>
      s
        .setName("받기")
        .setDescription("지금 추천곡 받기")
        .addIntegerOption((o) =>
          o
            .setName("개수")
            .setDescription(
              `추천받을 곡 수 (1~${rec.MAX_COUNT}, 기본 ${rec.DEFAULT_COUNT})`,
            )
            .setMinValue(1)
            .setMaxValue(rec.MAX_COUNT),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("차트")
        .setDescription(
          "추천 기준 사이트별 순위 TOP 10을 카테고리로 나눠서 보기",
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("상태")
        .setDescription("자동 추천 켜짐/꺼짐과 등록된 사이트 보기"),
    )
    .addSubcommand((s) =>
      s
        .setName("자동")
        .setDescription(
          "재생이 끝났을 때 추천곡을 자동으로 올릴지 설정 (기본: 꺼짐)",
        )
        .addStringOption((o) =>
          o
            .setName("설정")
            .setDescription("켜기 또는 끄기")
            .setRequired(true)
            .addChoices(
              { name: "켜기", value: "on" },
              { name: "끄기", value: "off" },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("사이트추가")
        .setDescription(`추천 기준 사이트 추가 (${SUPPORTED_TEXT})`)
        .addStringOption((o) =>
          o
            .setName("주소")
            .setDescription("재생목록 또는 앨범 주소")
            .setRequired(true)
            .setMaxLength(300),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("사이트삭제")
        .setDescription("등록한 사이트 지우기")
        .addIntegerOption((o) =>
          o
            .setName("번호")
            .setDescription("`/음악 상태`에 나온 번호")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(rec.MAX_SOURCES),
        ),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "❌ 서버 안에서만 사용할 수 있어요.",
        flags: EPHEMERAL,
      });
    }
    const sub = interaction.options.getSubcommand();
    if (MANAGER_ONLY.has(sub) && !isServerManager(interaction)) {
      return interaction.reply({
        content:
          "❌ 서버 소유자 또는 서버 관리 권한이 있는 역할만 설정할 수 있어요.",
        flags: EPHEMERAL,
      });
    }
    const guildId = interaction.guildId;

    if (sub === "차트") {
      if (Date.now() - (lastGet.get(guildId) ?? 0) < GET_COOLDOWN_MS) {
        return interaction.reply({
          content: "잠시 후에 다시 눌러 주세요. (5초에 한 번)",
          flags: EPHEMERAL,
        });
      }
      lastGet.set(guildId, Date.now());
      await interaction.reply("📊 차트를 불러오는 중…");
      let texts;
      try {
        texts = await rec.buildChartMessages(guildId);
      } catch (e) {
        console.error("🎧 차트 오류:", e?.message);
        return interaction.editReply(
          "📊 차트를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
      }
      // 카테고리 제목 아래에 사이트별 TOP 10 블록을 묶어 보낸다 (글자 수 제한을 넘으면 메시지를 나눈다)
      await interaction.editReply({
        content: texts[0],
        allowedMentions: { parse: [] },
      });
      for (const text of texts.slice(1)) {
        await interaction.followUp({
          content: text,
          allowedMentions: { parse: [] },
        });
      }
      return;
    }

    if (sub === "받기") {
      if (Date.now() - (lastGet.get(guildId) ?? 0) < GET_COOLDOWN_MS) {
        return interaction.reply({
          content: "잠시 후에 다시 눌러 주세요. (5초에 한 번)",
          flags: EPHEMERAL,
        });
      }
      lastGet.set(guildId, Date.now());
      await interaction.reply("🎧 추천곡을 찾는 중…");
      let tracks;
      try {
        tracks = await rec.pickRecommendations(
          guildId,
          interaction.options.getInteger("개수") ?? rec.DEFAULT_COUNT,
        );
      } catch (e) {
        if (e instanceof rec.RecError)
          return interaction.editReply(e.userMessage);
        console.error("🎧 추천 오류:", e?.message);
        return interaction.editReply(
          "🎧 추천곡을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
      }
      await interaction.editReply(rec.buildMessage(tracks));
      rec.attachButtons(await interaction.fetchReply(), tracks);
      return;
    }

    if (sub === "상태") {
      const { sources, isDefault } = rec.activeSources(guildId);
      const lines = sources.map(
        (s, i) => `${i + 1}. **${s.label}**${isDefault ? "" : ` · ${s.url}`}`,
      );
      return interaction.reply({
        content:
          `🎧 자동 추천: **${rec.isEnabled(guildId) ? "켜짐" : "꺼짐"}** (켜면 재생이 끝날 때 추천곡을 올려요)\n` +
          (isDefault
            ? `📚 기본 사이트를 쓰고 있어요 (서버 운영자가 \`/음악 추천사이트추가\`로 직접 등록하면 그 사이트가 우선해요)\n${lines.join("\n")}`
            : `📚 서버 운영자가 정한 추천 기준 사이트 ${sources.length}/${rec.MAX_SOURCES}곳\n${lines.join("\n")}`) +
          "\n-# `/음악 추천받기`로 언제든 추천받을 수 있어요",
        flags: EPHEMERAL,
        allowedMentions: { parse: [] },
      });
    }

    if (sub === "자동") {
      const on = interaction.options.getString("설정") === "on";
      rec.setEnabled(guildId, on);
      return interaction.reply({
        content: on
          ? "✅ 자동 추천을 켰어요. 재생이 끝나면 추천곡을 올릴게요. (10분에 한 번까지)"
          : "🔕 자동 추천을 껐어요. `/음악 추천받기`로는 계속 추천받을 수 있어요.",
        flags: EPHEMERAL,
      });
    }

    if (sub === "사이트추가") {
      let parsed;
      try {
        parsed = parseSource(interaction.options.getString("주소"));
      } catch (e) {
        if (e instanceof SourceError)
          return interaction.reply({
            content: e.userMessage,
            flags: EPHEMERAL,
          });
        throw e;
      }
      const result = rec.addSource(guildId, parsed);
      const text =
        result === "added"
          ? `✅ **${parsed.label}** 사이트를 추천 기준에 추가했어요. (${rec.listSources(guildId).length}/${rec.MAX_SOURCES})`
          : result === "duplicate"
            ? "ℹ️ 이미 등록된 사이트예요."
            : `❌ 사이트는 서버당 최대 ${rec.MAX_SOURCES}곳까지 등록할 수 있어요. \`/음악 추천사이트삭제\`로 정리해 주세요.`;
      return interaction.reply({ content: text, flags: EPHEMERAL });
    }

    // 사이트삭제
    const removed = rec.removeSourceAt(
      guildId,
      interaction.options.getInteger("번호"),
    );
    if (!removed)
      return interaction.reply({
        content:
          "❌ 그 번호의 사이트가 없어요. `/음악 상태`에서 번호를 확인해 주세요.",
        flags: EPHEMERAL,
      });
    const rest = rec.listSources(guildId).length
      ? ""
      : " 등록한 사이트가 없어서 이제 기본 사이트를 써요.";
    return interaction.reply({
      content: `🗑️ **${removed.label}** 사이트를 지웠어요.${rest}`,
      flags: EPHEMERAL,
    });
  },
};
