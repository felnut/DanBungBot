const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
  MessageFlags,
} = require("discord.js");
const db = require("../../../Database");
const { isServerAdmin } = require("../utils/perm");
const {
  neisRows,
  getSchools,
  MAX_SCHOOLS,
  schoolAutocomplete,
} = require("../utils/neis");

const EPHEMERAL = MessageFlags.Ephemeral;

const stmtCount = db.prepare(
  "SELECT COUNT(*) AS n FROM guild_schools WHERE guild_id = ?",
);
const stmtHas = db.prepare(
  "SELECT 1 FROM guild_schools WHERE guild_id = ? AND school_code = ?",
);
const stmtInsert = db.prepare(
  `INSERT INTO guild_schools (guild_id, school_code, atpt_code, school_name, school_kind, registered_by, registered_at, is_default)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
const stmtDelete = db.prepare(
  "DELETE FROM guild_schools WHERE guild_id = ? AND school_code = ?",
);
const stmtClearDefault = db.prepare(
  "UPDATE guild_schools SET is_default = 0 WHERE guild_id = ?",
);
const stmtSetDefault = db.prepare(
  "UPDATE guild_schools SET is_default = 1 WHERE guild_id = ? AND school_code = ?",
);
const stmtFirst = db.prepare(
  "SELECT school_code FROM guild_schools WHERE guild_id = ? ORDER BY registered_at ASC LIMIT 1",
);

/** 학교를 추가한다. 결과: "added" | "duplicate" | "full" (동시에 여러 명이 등록해도 한도를 넘지 않도록 한 번에 처리) */
const addSchool = db.transaction((guildId, r, userId) => {
  if (stmtHas.get(guildId, r.SD_SCHUL_CODE)) return "duplicate";
  const n = stmtCount.get(guildId).n;
  if (n >= MAX_SCHOOLS) return "full";
  // 첫 학교는 자동으로 기본 학교가 된다
  stmtInsert.run(
    guildId,
    r.SD_SCHUL_CODE,
    r.ATPT_OFCDC_SC_CODE,
    r.SCHUL_NM,
    r.SCHUL_KND_SC_NM,
    userId,
    Date.now(),
    n === 0 ? 1 : 0,
  );
  return "added";
});

/** 학교 하나를 지우고, 기본 학교였다면 가장 먼저 등록한 학교를 기본으로 올린다 */
const removeSchool = db.transaction((guildId, code, wasDefault) => {
  stmtDelete.run(guildId, code);
  if (wasDefault) {
    const next = stmtFirst.get(guildId);
    if (next) stmtSetDefault.run(guildId, next.school_code);
  }
});

const setDefault = db.transaction((guildId, code) => {
  stmtClearDefault.run(guildId);
  stmtSetDefault.run(guildId, code);
});

const schoolOption = (required, desc) => (o) =>
  o
    .setName("학교")
    .setDescription(desc)
    .setRequired(required)
    .setAutocomplete(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("학교등록")
    .setDescription(
      `이 서버의 학교를 최대 ${MAX_SCHOOLS}곳 등록해요 · 기본 학교 지정·해제는 관리자 전용`,
    )
    // 기본 권한을 두지 않는다: 등록·확인은 누구나, 기본 지정·해제는 실행할 때 관리자인지 확인한다
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("검색")
        .setDescription("학교 이름으로 찾아서 추가 등록")
        .addStringOption((o) =>
          o
            .setName("이름")
            .setDescription("학교 이름 (예: 한빛고등학교)")
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(30),
        ),
    )
    .addSubcommand((s) =>
      s.setName("확인").setDescription("등록된 학교 목록 보기"),
    )
    .addSubcommand((s) =>
      s
        .setName("기본")
        .setDescription("학교를 고르지 않았을 때 쓸 기본 학교 지정")
        .addStringOption(schoolOption(true, "기본으로 쓸 학교")),
    )
    .addSubcommand((s) =>
      s
        .setName("해제")
        .setDescription("등록한 학교 지우기")
        .addStringOption(
          schoolOption(false, "지울 학교 (하나뿐이면 비워도 돼요)"),
        ),
    ),

  autocomplete: schoolAutocomplete,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    // 검색(등록)·확인은 누구나, 기본 지정·해제는 서버 소유자·관리자만
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "❌ 서버 안에서만 사용할 수 있어요.",
        flags: EPHEMERAL,
      });
    }
    if ((sub === "해제" || sub === "기본") && !isServerAdmin(interaction)) {
      return interaction.reply({
        content:
          "❌ 기본 학교 지정과 학교 해제는 서버 소유자 또는 관리자만 할 수 있어요.",
        flags: EPHEMERAL,
      });
    }
    const guildId = interaction.guildId;

    if (sub === "확인") {
      const list = getSchools(guildId);
      if (!list.length)
        return interaction.reply({
          content: "등록된 학교가 없어요. `/학교 등록 검색`으로 등록해 주세요.",
          flags: EPHEMERAL,
        });
      const lines = list.map(
        (s, i) =>
          `${i + 1}. ${s.isDefault ? "⭐ " : ""}**${s.name}** (${s.kind})`,
      );
      return interaction.reply({
        content: `🏫 등록된 학교 ${list.length}/${MAX_SCHOOLS}곳\n${lines.join("\n")}\n-# ⭐ 기본 학교 · 급식·시간표·학사일정에서 \`학교\` 칸으로 고를 수 있어요`,
        flags: EPHEMERAL,
      });
    }

    if (sub === "기본" || sub === "해제") {
      const list = getSchools(guildId);
      if (!list.length)
        return interaction.reply({
          content: "등록된 학교가 없어요.",
          flags: EPHEMERAL,
        });
      const picked = interaction.options.getString("학교");
      const target = picked
        ? list.find((s) => s.code === picked)
        : list.length === 1
          ? list[0]
          : null;
      if (!target) {
        return interaction.reply({
          content: picked
            ? "❌ 이 서버에 등록되지 않은 학교예요. `학교` 칸의 목록에서 골라 주세요."
            : "❌ 학교가 여러 곳이에요. `학교` 칸에서 하나를 골라 주세요.",
          flags: EPHEMERAL,
        });
      }
      if (sub === "기본") {
        setDefault(guildId, target.code);
        return interaction.reply({
          content: `⭐ **${target.name}**을(를) 기본 학교로 지정했어요.`,
          flags: EPHEMERAL,
        });
      }
      removeSchool(guildId, target.code, target.isDefault);
      const left = list.length - 1;
      return interaction.reply({
        content: `🗑️ **${target.name}** 등록을 지웠어요.${left ? ` (남은 학교 ${left}곳)` : " 급식·시간표·학사일정은 다시 등록하기 전까지 쓸 수 없어요."}`,
        flags: EPHEMERAL,
      });
    }

    // 검색 → 선택 → 추가 등록
    if (stmtCount.get(guildId).n >= MAX_SCHOOLS) {
      return interaction.reply({
        content: `❌ 학교는 서버당 최대 ${MAX_SCHOOLS}곳까지 등록할 수 있어요. 관리자가 \`/학교 등록 해제\`로 정리해 주세요.`,
        flags: EPHEMERAL,
      });
    }
    const query = interaction.options.getString("이름").trim();
    await interaction.reply({
      content: "🔎 학교를 찾는 중…",
      flags: EPHEMERAL,
    });
    let rows;
    try {
      rows = await neisRows(
        null,
        "schoolInfo",
        { SCHUL_NM: query, pSize: 25 },
        10 * 60 * 1000,
      );
    } catch (e) {
      console.error("학교 검색 오류:", e.message);
      return interaction.editReply(
        "🚨 학교를 검색하는 중에 오류가 발생했어요. 잠시 후 다시 시도해 주세요.",
      );
    }
    rows = rows
      .filter((r) =>
        ["초등학교", "중학교", "고등학교", "특수학교"].includes(
          r.SCHUL_KND_SC_NM,
        ),
      )
      .slice(0, 25);
    if (!rows.length) {
      return interaction.editReply(
        `📭 "${query}"에 해당하는 학교가 없어요. 이름의 일부만 입력해 보세요. (초·중·고·특수학교만 지원)`,
      );
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId("school:pick")
      .setPlaceholder("등록할 학교를 선택하세요")
      .addOptions(
        rows.map((r, i) => ({
          label: r.SCHUL_NM.slice(0, 100),
          description:
            `${r.ATPT_OFCDC_SC_NM} · ${r.SCHUL_KND_SC_NM}${r.ORG_RDNMA ? ` · ${r.ORG_RDNMA}` : ""}`.slice(
              0,
              100,
            ),
          value: String(i),
        })),
      );
    await interaction.editReply({
      content: `🏫 "${query}" 검색 결과 ${rows.length}곳 — 선택하면 이 서버의 학교로 추가돼요.`,
      components: [new ActionRowBuilder().addComponents(menu)],
    });
    const message = await interaction.fetchReply();

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 60 * 1000,
      max: 1,
      filter: (i) => i.user.id === interaction.user.id,
    });
    collector.on("collect", async (i) => {
      const r = rows[Number(i.values[0])];
      if (!r) return;
      const result = addSchool(guildId, r, interaction.user.id);
      const text =
        result === "added"
          ? `✅ **${r.SCHUL_NM}** (${r.ATPT_OFCDC_SC_NM} · ${r.SCHUL_KND_SC_NM})을(를) 이 서버의 학교로 추가했어요!`
          : result === "duplicate"
            ? `ℹ️ **${r.SCHUL_NM}**은(는) 이미 등록돼 있어요.`
            : `❌ 학교는 서버당 최대 ${MAX_SCHOOLS}곳까지 등록할 수 있어요.`;
      await i.update({ content: text, components: [] });
    });
    collector.on("end", async (collected) => {
      if (!collected.size)
        await interaction
          .editReply({
            content: "⏱️ 시간이 지나서 취소됐어요.",
            components: [],
          })
          .catch(() => {});
    });
  },
};
