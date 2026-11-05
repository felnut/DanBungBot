require("dotenv").config({ path: ".env", override: true });
const { REST, Routes, InteractionContextType } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

// ================== .env 파일 검증 및 자동 수정 함수 ==================
// 필수 환경 변수가 있는지 확인, 값에 포함된 불필요한 공백이나 따옴표를 제거
function validateAndSanitizeEnv({ autoFix = true } = {}) {
  const required = ["DISCORD_TOKEN", "CLIENT_ID", "GUILD_ID"];
  const envPath = path.join(__dirname, ".env");
  let fixed = false;

  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, "utf8");
    const lines = raw.split(/\r?\n/);
    const out = lines.map((line) => {
      // 주석이나 빈 줄은 그대로 통과
      if (/^\s*#/.test(line) || /^\s*$/.test(line)) return line;
      const idx = line.indexOf("=");
      if (idx === -1) return line;

      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();

      // 값 양끝의 따옴표 제거
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }

      const newVal = val.trim();
      if (newVal !== val) fixed = true;
      return `${key}=${newVal}`;
    });

    // 변경 사항이 있으면 기존 파일을 백업하고 새로 저장
    if (fixed && autoFix) {
      try {
        fs.copyFileSync(envPath, `${envPath}.back`);
        fs.writeFileSync(envPath, out.join("\n"), "utf8");
        console.log(
          ".env 파일의 공백/따옴표를 정리했습니다. (백업: .env.back)",
        );
      } catch (err) {
        console.warn(".env 자동 수정 실패:", err.message);
      }
    }
  }

  // 필수 환경 변수 누락 체크
  const missing = required.filter(
    (k) => !process.env[k] || process.env[k].trim() === "",
  );
  if (missing.length) {
    console.error("필수 설정값이 누락되었습니다:", missing.join(", "));
    console.error(
      ".env 파일에 위 항목들이 올바르게 입력되었는지 확인해 주세요.",
    );
    return false;
  }

  // 토큰 형식 체크
  if (!process.env.DISCORD_TOKEN.startsWith("M")) {
    console.warn("주의: DISCORD_TOKEN 형식이 올바르지 않은 것 같습니다.");
  }

  return true;
}

// ================== 로컬 명령어 파일 읽기 및 데이터 수집 ==================
const commands = []; // 서버 명령어
const dmCommands = []; // DM 전용 명령어

// bot/commands 하위의 모든 명령어 파일에서 명령어 데이터 읽어오기 (묶음 명령어에 들어간 파일은 묶음으로만 나온다)
for (const command of require("./bot/commandLoader").loadCommands()) {
  const json = command.data.toJSON();
  // DM 전용(봇과의 1:1 대화에서만 쓰는) 명령어는 서버가 아니라 전역으로 등록해야 DM에 나타난다
  const dmOnly =
    Array.isArray(json.contexts) &&
    json.contexts.length > 0 &&
    json.contexts.every((c) => c === InteractionContextType.BotDM);
  (dmOnly ? dmCommands : commands).push(json);
}

// 디스코드 API에 접근하기 위한 REST 클라이언트 초기화
const rest = new REST().setToken(process.env.DISCORD_TOKEN);

// ================== 디스코드 API를 호출하여 명령어 최종 등록 ==================
async function deployCommands() {
  if (!validateAndSanitizeEnv()) {
    console.error("🔎 .env 설정을 먼저 확인해주세요!");
    return false;
  }

  try {
    // 등록 대상: .env의 GUILD_ID + 봇이 들어가 있는 모든 서버 (서버마다 따로 등록해야 명령어가 갱신된다)
    const targets = new Map([[process.env.GUILD_ID, "GUILD_ID"]]);
    try {
      const joined = await rest.get(Routes.userGuilds(), {
        query: new URLSearchParams({ limit: "200" }),
      });
      for (const g of joined) if (!targets.has(g.id)) targets.set(g.id, g.name);
    } catch (e) {
      console.warn(
        "참여 중인 서버 목록을 가져오지 못해 GUILD_ID 서버에만 등록합니다:",
        e?.message || e,
      );
    }

    console.log(
      `${commands.length}개의 명령어를 디스코드에 등록하는 중... (서버 ${targets.size}곳)`,
    );
    let failed = 0;
    for (const [guildId, label] of targets) {
      try {
        await rest.put(
          Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
          { body: commands },
        );
        console.log(`  ✅ ${label} (${guildId})`);
      } catch (e) {
        failed += 1;
        console.error(`  ❌ ${label} (${guildId}): ${e?.message || e}`);
        if (e?.status === 401) throw e; // 토큰 문제는 바로 중단
      }
    }
    // 전역 명령어는 DM 전용 명령어만 담는다 (서버 명령어는 위처럼 서버별로 등록)
    try {
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
        body: dmCommands,
      });
      console.log(
        `  ✅ DM 전용 명령어 ${dmCommands.length}개 (전역 등록 — 디스코드에 반영되기까지 잠시 걸릴 수 있어요)`,
      );
    } catch (e) {
      failed += 1;
      console.error(`  ❌ DM 전용 명령어: ${e?.message || e}`);
    }

    if (failed === targets.size + 1) return false;
    console.log(
      failed
        ? `⚠️ 일부 서버(${failed}곳)는 등록에 실패했어요.`
        : "✅ 명령어 등록 성공!",
    );
    return true; // 성공 반환
  } catch (error) {
    if (error?.status === 401) {
      console.error("인증 실패 (401): DISCORD_TOKEN 다시 확인해주세요");
      return false; // 실패 반환
    }
    console.error("명령어 등록 실패:", error?.message || error);
    return false; // 실패 반환
  }
}

module.exports = { deployCommands };
