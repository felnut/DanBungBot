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
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const {
  updateStockPrices,
  createStockUpdateEmbed,
} = require("./bot/stockManager");

// DB 자동 연결
require("./Database");

// 커맨드 핸들러
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
      client.commands.set(command.data.name, command);
    }
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    const errorMsg = {
      content: "에러가 발생했습니다!",
      flags: [MessageFlags.Ephemeral],
    };
    if (interaction.replied || interaction.deferred)
      await interaction.followUp(errorMsg);
    else await interaction.editReply(errorMsg);
  }
});

// 클라이언트 레디 후 타이머
client.once(Events.ClientReady, (c) => {
  console.log(`✅ 준비 완료! 계정: ${c.user.tag}`);

  startScheduler();

  function getKSTNow() {
    return new Date(Date.now() + 9 * 60 * 60 * 1000);
  }

  function startScheduler() {
    const now = getKSTNow();

    let nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);

    let delayMs = nextHour - now;

    // 정각 직후 켜졌을 때 이번은 스킵 (선택)
    if (delayMs < 30 * 1000) {
      // 30초 이내 → 다음 시간으로
      nextHour.setHours(nextHour.getHours() + 1);
      delayMs = nextHour - now;
    }

    console.log(
      `다음 주가 업데이트 (KST): ${nextHour.toLocaleString("ko-KR")} ` +
        `(약 ${Math.round(delayMs / 60000)}분 ${Math.round((delayMs % 60000) / 1000)}초 후)`,
    );

    setTimeout(async () => {
      await performUpdate();
      startScheduler(); // 재귀 호출
    }, delayMs);
  }

  async function performUpdate() {
    try {
      await updateStockPrices();
      const channelId = "1466810539496706255";
      const channel = await client.channels.fetch(channelId).catch(() => null);

      if (channel) {
        const updateEmbed = createStockUpdateEmbed();
        await channel.send({
          embeds: [updateEmbed],
          flags: MessageFlags.SuppressNotifications,
        });
        console.log(
          `정시 업데이트 완료: ${getKSTNow().toLocaleString("ko-KR")}`,
        );
      } else {
        console.log("알림 채널을 찾을 수 없음");
      }
    } catch (err) {
      console.error("업데이트 중 오류:", err);
    }
  }
});

// deploy 함수 불러오기
const { deployCommands } = require("./deploy-commands");
async function start() {
  // --deploy 붙이면 자동 등록 후 종료 (로그인 안 함)
  if (process.argv.includes("--deploy")) {
    console.log("🔄 커맨드 등록 시작합니다...");
    const success = await deployCommands();
    if (success) {
      console.log("✅ 등록 완료! 프로세스 종료.");
      setTimeout(() => process.exit(0), 1000); // 성공 종료
    } else {
      console.error("❌ 등록 실패! 프로세스 종료.");
      setTimeout(() => process.exit(0), 1000); // 실패 종료
    }
  }

  // --deploy 없을 때만 로그인
  try {
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    console.error(err);
  }
}
start();
