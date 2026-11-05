// NEIS 교육정보 개방 포털 공통 도우미 (급식·시간표·학사일정·학교등록에서 사용)
const axios = require("axios");
const MessageFlags = require("discord.js").MessageFlags;
const db = require("../../../Database");
const cache = require("./cache");

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const TIMETABLE_SERVICE = {
  초등학교: "elsTimetable",
  중학교: "misTimetable",
  고등학교: "hisTimetable",
  특수학교: "spsTimetable",
};

const MAX_SCHOOLS = 5; // 서버당 등록할 수 있는 학교 수

// 기본 학교가 맨 앞, 그 다음은 먼저 등록한 순서
const stmtSchools = db.prepare(
  "SELECT * FROM guild_schools WHERE guild_id = ? ORDER BY is_default DESC, registered_at ASC",
);

function toSchool(r) {
  return {
    atpt: r.atpt_code,
    code: r.school_code,
    name: r.school_name,
    kind: r.school_kind,
    isDefault: Boolean(r.is_default),
    timetableService: TIMETABLE_SERVICE[r.school_kind] ?? null,
    maxGrade: r.school_kind === "초등학교" ? 6 : 3,
  };
}

/** 서버에 등록된 모든 학교 (기본 학교가 맨 앞) */
function getSchools(guildId) {
  if (!guildId) return [];
  return stmtSchools.all(guildId).map(toSchool);
}

/** 서버의 학교 하나. code가 없으면 기본 학교. 없으면 null */
function getSchool(guildId, code = null) {
  const list = getSchools(guildId);
  return (code ? list.find((s) => s.code === code) : list[0]) ?? null;
}

/** 급식·시간표·학사일정 같은 명령어에 '학교' 선택 옵션(자동완성)을 붙인다 */
function addSchoolOption(builder) {
  return builder.addStringOption((o) =>
    o
      .setName("학교")
      .setDescription("학교 선택 (여러 곳을 등록한 경우. 비우면 기본 학교)")
      .setRequired(false)
      .setAutocomplete(true),
  );
}

/** '학교' 옵션의 자동완성: 이 서버에 등록된 학교 목록을 보여준다 */
async function schoolAutocomplete(interaction) {
  const typed = String(interaction.options.getFocused() ?? "").trim();
  const choices = getSchools(interaction.guildId)
    .filter((s) => !typed || s.name.includes(typed))
    .slice(0, 25)
    .map((s) => ({
      name: `${s.isDefault ? "⭐ " : ""}${s.name} (${s.kind})`.slice(0, 100),
      value: s.code,
    }));
  await interaction.respond(choices);
}

/**
 * 이번 명령에 쓸 학교를 돌려준다 (명령어 맨 앞에서 호출).
 * '학교' 옵션으로 고른 학교, 없으면 기본 학교. 학교가 없거나 잘못 골랐으면 안내 메시지를 보내고 null
 */
async function requireSchool(interaction) {
  const schools = getSchools(interaction.guildId);
  if (!schools.length) {
    await interaction.reply({
      content:
        "🏫 이 서버에 등록된 학교가 없어요. `/학교 등록 검색`으로 먼저 학교를 등록해 주세요.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
  const picked = interaction.options.getString("학교");
  if (!picked) return schools[0];
  const school = schools.find((s) => s.code === picked);
  if (!school) {
    await interaction.reply({
      content:
        "❌ 이 서버에 등록되지 않은 학교예요. `학교` 칸에서 목록에 뜨는 학교를 골라 주세요.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
  return school;
}

/** 한국 시각(KST) 기준 날짜. offsetDays만큼 이동 */
function kstDate(offsetDays = 0, base = Date.now()) {
  const d = new Date(base + 9 * 3600 * 1000 + offsetDays * 86400 * 1000);
  const iso = d.toISOString().slice(0, 10); // YYYY-MM-DD
  return {
    iso,
    ymd: iso.replace(/-/g, ""),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
    weekday: WEEKDAYS[d.getUTCDay()],
    dow: d.getUTCDay(),
  };
}

/** YYYYMMDD → "10/20(화)" */
function shortDate(ymd) {
  const d = new Date(
    Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)),
  );
  return `${+ymd.slice(4, 6)}/${+ymd.slice(6, 8)}(${WEEKDAYS[d.getUTCDay()]})`;
}

/**
 * NEIS 서비스를 호출해 행 목록을 돌려준다 (결과는 기본 30분 캐시).
 * school이 있으면 그 학교의 교육청·학교 코드를 붙인다. 오류 메시지에는 API 키가 들어가지 않는다.
 */
async function neisRows(school, service, params = {}, ttlMs = 30 * 60 * 1000) {
  const key = process.env.NEIS_KEY || process.env.NEIS_TOKEN;
  if (!key) throw new Error("NEIS API 키가 설정되지 않았어요.");
  const base = school
    ? { ATPT_OFCDC_SC_CODE: school.atpt, SD_SCHUL_CODE: school.code }
    : {};
  const cacheKey = `neis:${service}:${JSON.stringify({ ...base, ...params })}`;
  return cache.getOrSet(cacheKey, ttlMs, async () => {
    let data;
    try {
      const res = await axios.get(`https://open.neis.go.kr/hub/${service}`, {
        timeout: 5000,
        params: {
          KEY: key,
          Type: "json",
          pIndex: 1,
          pSize: 100,
          ...base,
          ...params,
        },
      });
      data = res.data;
    } catch (e) {
      throw new Error(`NEIS ${service} 요청 실패: ${e.message}`);
    }
    const code =
      data?.RESULT?.CODE ?? data?.[service]?.[0]?.head?.[1]?.RESULT?.CODE;
    if (code === "INFO-200") return []; // 해당 데이터 없음
    if (code && code !== "INFO-000")
      throw new Error(`NEIS ${service} 오류: ${code}`);
    return data?.[service]?.[1]?.row ?? [];
  });
}

module.exports = {
  WEEKDAYS,
  MAX_SCHOOLS,
  getSchool,
  getSchools,
  requireSchool,
  addSchoolOption,
  schoolAutocomplete,
  kstDate,
  shortDate,
  neisRows,
};
