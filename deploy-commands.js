const envFile = process.argv.includes("--test") ? ".env.test" : ".env";
require("dotenv").config({ path: envFile, override: true });
const { REST, Routes } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

// .env 검증 함수
function validateAndSanitizeEnv({ autoFix = true } = {}) {
  const required = ["DISCORD_TOKEN", "CLIENT_ID", "GUILD_ID"];
  const envPath = path.join(__dirname, ".env");
  let fixed = false;

  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, "utf8");
    const lines = raw.split(/\r?\n/);
    const out = lines.map((line) => {
      if (/^\s*#/.test(line) || /^\s*$/.test(line)) return line;
      const idx = line.indexOf("=");
      if (idx === -1) return line;
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();

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

  if (!process.env.DISCORD_TOKEN.startsWith("M")) {
    console.warn("주의: DISCORD_TOKEN 형식이 올바르지 않은 것 같습니다.");
  }

  return true;
}

// 명령어 수집
const commands = [];
const foldersPath = path.join(__dirname, "bot/commands");
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith(".js"));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ("data" in command && "execute" in command) {
      commands.push(command.data.toJSON());
    }
  }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

async function deployCommands() {
  if (!validateAndSanitizeEnv()) {
    console.error("🔎 .env 설정을 먼저 확인해주세요!");
    return false;
  }

  try {
    console.log(`${commands.length}개의 명령어를 디스코드에 등록하는 중...`);
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID,
      ),
      { body: commands },
    );
    console.log("✅ 명령어 등록 성공!");
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
