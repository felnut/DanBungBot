const envFile = process.argv.includes("--test") ? ".env.test" : ".env";
require("dotenv").config({ path: envFile, override: true });
const {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  MessageFlags,
} = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

// ================== 봇 클라이언트 생성 및 인텐트 설정 ==================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, // 서버 기본 정보 수신
    GatewayIntentBits.GuildVoiceStates, // 음성 채널 상태 변화 수신
    GatewayIntentBits.GuildMessages, // 서버 메시지 수신
    GatewayIntentBits.MessageContent, // 메시지 내용 읽기 허용
  ],
});

const {
  updateStockPrices,
  createStockUpdateEmbed,
  TICK_MINUTES,
} = require("./bot/managers/stockManager");

// DB 자동 연결 (초기화 및 마이그레이션 실행)
require("./Database");

// ================== 커맨드 핸들러 초기화 ==================
// 컬렉션을 생성해 봇이 메모리에 명령어를 기억
client.commands = new Collection();
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
      client.commands.set(command.data.name, command); // 컬렉션에 등록
    }
  }
}

// ================== 유저와의 인터랙션(슬래시 명령어) 발생 시 처리 ==================
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command?.autocomplete) return;
    try {
      await command.autocomplete(interaction);
    } catch (error) {
      console.error(error);
      try {
        await interaction.respond([]);
      } catch {
        /* 이미 응답했거나 만료됨 */
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return; // 채팅 명령어가 아니면 무시

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction); // 명령어 실행
  } catch (error) {
    console.error(error);
    const errorMsg = {
      content: "에러가 발생했습니다!",
      flags: [MessageFlags.Ephemeral], // 나에게만 보이는 메시지 속성
    };

    // 응답 지연(defer) 상태에 따라 적절한 메서드로 에러 안내
    try {
      if (interaction.replied || interaction.deferred)
        await interaction.followUp(errorMsg);
      else await interaction.reply(errorMsg);
    } catch (e) {
      console.error("에러 응답 실패:", e);
    }
  }
});

// ================== 클라이언트 준비 완료(로그인 성공) 이벤트 ==================
client.once(Events.ClientReady, (c) => {
  console.log(`✅ 준비 완료! 계정: ${c.user.tag}`);

  // 주식 업데이트 타이머 시작
  startScheduler();

  // 야구 게임 이벤트 연동
  const baseballGuessEvent = require("./bot/events/messageCreate/baseballGuess");
  baseballGuessEvent(client);

  // 한국 표준시(KST) 현재 시간 가져오기
  function getKSTNow() {
    return new Date(Date.now() + 9 * 60 * 60 * 1000);
  }

  // ================== TICK_MINUTES분 간격(정각 기준 정렬) 스케줄러 ==================
  function startScheduler() {
    const tickMs = TICK_MINUTES * 60 * 1000;
    let delayMs = tickMs - (Date.now() % tickMs); // 다음 경계(예: 10분 단위)까지 남은 시간

    // 경계 직후(30초 이내) 켜졌을 때 즉시 연속 실행되는 것을 방지하기 위해 한 틱 스킵
    if (delayMs < 30 * 1000) delayMs += tickMs;

    const next = new Date(Date.now() + delayMs);
    console.log(
      `다음 주가 업데이트: ${next.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} ` +
        `(약 ${Math.round(delayMs / 60000)}분 ${Math.round((delayMs % 60000) / 1000)}초 후)`,
    );

    setTimeout(async () => {
      await performUpdate();
      startScheduler(); // 실행 후 다음 경계를 위해 재귀 호출(무한 반복)
    }, delayMs);
  }

  // ================== 주식 업데이트 수행 및 디스코드 채널 전송 ==================
  async function performUpdate() {
    try {
      await updateStockPrices(); // 가격 변동 계산
      // 메시지 전송 부분 일시 주석 처리
      // const channelId = "1479512968231260432";
      // const channel = await client.channels.fetch(channelId).catch(() => null);

      // // 알림 채널이 유효하면 Embed를 전송
      // if (channel) {
      //   const updateEmbed = createStockUpdateEmbed();
      //   await channel.send({
      //     embeds: [updateEmbed],
      //     flags: MessageFlags.SuppressNotifications, // 푸시 알림 없이 조용히 전송
      //   });
      //   console.log(
      //     `정시 업데이트 완료: ${getKSTNow().toLocaleString("ko-KR")}`,
      //   );
      // } else {
      //   console.log("알림 채널을 찾을 수 없음");
      // }
    } catch (err) {
      console.error("업데이트 중 오류:", err);
    }
  }
});

// ================== 메인 시작 함수 ==================
const { deployCommands } = require("./deploy-commands");
async function start() {
  // 실행 인자에 "--deploy"가 포함되어 있다면 명령어 등록만 하고 봇 종료
  if (process.argv.includes("--deploy")) {
    console.log("🔄 커맨드 등록 시작합니다...");
    const success = await deployCommands();
    if (success) {
      console.log("✅ 등록 완료! 프로세스 종료.");
      setTimeout(() => process.exit(0), 1000); // 성공 종료
    } else {
      console.error("❌ 등록 실패! 프로세스 종료.");
      setTimeout(() => process.exit(1), 1000); // 실패 종료
    }
    return; // 등록 후에는 봇 로그인하지 않음
  }

  // "--deploy" 옵션이 없을 때만 봇 로그인 수행
  try {
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    console.error(err);
  }
}
start();
