const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const { LavalinkManager } = require("lavalink-client");

let manager = null;

// 길드별 재생 패널 메시지
const panels = new Map();

const PANEL_COLOR = 0x5865f2;

const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

/** 재생 패널(임베드 + 버튼) 생성 */
function panelPayload(player) {
  const track = player.queue.current;
  if (!track) return null;
  const info = track.info;
  const upcoming = player.queue.tracks.slice(0, 3);
  const more = player.queue.tracks.length - upcoming.length;

  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setAuthor({ name: player.paused ? "⏸️ 일시정지됨" : "🎶 지금 재생 중" })
    .setTitle(info.title)
    .setDescription(`**${info.author || "알 수 없음"}**`)
    .addFields(
      { name: "길이", value: info.isStream ? "🔴 LIVE" : fmt(info.duration), inline: true },
      {
        name: "신청자",
        value: track.requester?.id ? `<@${track.requester.id}>` : "-",
        inline: true,
      },
    );
  if (info.uri) embed.setURL(info.uri);
  if (info.artworkUrl) embed.setThumbnail(info.artworkUrl);
  if (upcoming.length) {
    embed.addFields({
      name: "다음 곡",
      value:
        upcoming.map((t, i) => `${i + 1}. ${t.info.title}`).join("\n") +
        (more > 0 ? `\n… 외 ${more}곡` : ""),
    });
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music:pause")
      .setEmoji(player.paused ? "▶️" : "⏸️")
      .setLabel(player.paused ? "재개" : "일시정지")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("music:skip").setEmoji("⏭️").setLabel("스킵").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:stop").setEmoji("⏹️").setLabel("정지").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("music:queue").setEmoji("📃").setLabel("대기열").setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1] };
}

/** 패널을 종료 상태로 바꿈 (버튼 제거) */
async function closePanel(guildId, text) {
  const msg = panels.get(guildId);
  panels.delete(guildId);
  if (!msg) return;
  const old = msg.embeds[0];
  const embed = EmbedBuilder.from(old ?? {})
    .setColor(0x747f8d)
    .setAuthor({ name: text });
  await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
}

/** 현재 패널 메시지를 최신 상태로 갱신 */
async function refreshPanel(player) {
  const msg = panels.get(player.guildId);
  const payload = panelPayload(player);
  if (!msg || !payload) return;
  await msg.edit(payload).catch(() => {});
}

/** 패널 버튼 처리 (index.js의 InteractionCreate에서 호출) */
async function handleMusicButton(interaction) {
  const action = interaction.customId.split(":")[1];
  const player = manager?.getPlayer(interaction.guildId);
  if (!player || !player.queue.current) {
    return interaction.reply({ content: "재생 중인 음악이 없어요.", flags: MessageFlags.Ephemeral });
  }
  if (interaction.member.voice?.channelId !== player.voiceChannelId) {
    return interaction.reply({
      content: "봇과 같은 음성 채널에 있어야 사용할 수 있어요.",
      flags: MessageFlags.Ephemeral,
    });
  }

  switch (action) {
    case "pause":
      if (player.paused) await player.resume();
      else await player.pause();
      return interaction.update(panelPayload(player));
    case "skip":
      await interaction.deferUpdate();
      // 다음 곡이 없으면 패널을 종료 상태로 둔다 (다음 곡이 있으면 trackStart가 새 패널을 보냄)
      return player.skip();
    case "stop":
      await interaction.deferUpdate();
      return player.destroy("stop");
    case "queue": {
      const cur = player.queue.current;
      const list = player.queue.tracks
        .slice(0, 15)
        .map((t, i) => `${i + 1}. ${t.info.title} (${fmt(t.info.duration)})`);
      const more = player.queue.tracks.length - 15;
      const embed = new EmbedBuilder()
        .setColor(PANEL_COLOR)
        .setTitle("📃 대기열")
        .setDescription(
          `**지금 재생 중**\n${cur.info.title}\n\n` +
            (list.length ? list.join("\n") : "대기열이 비어 있어요.") +
            (more > 0 ? `\n… 외 ${more}곡` : ""),
        );
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  }
}

/** Lavalink 클라이언트 생성 (index.js에서 한 번 호출) */
function createMusicManager(client) {
  manager = new LavalinkManager({
    nodes: [
      {
        id: "main",
        host: process.env.LAVALINK_HOST || "127.0.0.1",
        port: Number(process.env.LAVALINK_PORT) || 2333,
        authorization: process.env.LAVALINK_PASSWORD || "CHANGE_ME",
        retryAmount: 10,
        retryDelay: 10_000,
      },
    ],
    sendToShard: (guildId, payload) =>
      client.guilds.cache.get(guildId)?.shard?.send(payload),
    autoSkip: true,
    client: { id: process.env.CLIENT_ID || "0", username: "단붕봇" },
    playerOptions: {
      defaultSearchPlatform: "scsearch",
      onDisconnect: { autoReconnect: false, destroyPlayer: true },
      // 큐가 비면 30초 뒤 자동 퇴장
      onEmptyQueue: { destroyAfterMs: 30_000 },
    },
  });

  manager.nodeManager.on("connect", (node) =>
    console.log(`🎵 Lavalink 연결됨: ${node.id}`),
  );
  manager.nodeManager.on("error", (node, error) =>
    console.error(`🎵 Lavalink 오류(${node.id}):`, error.message),
  );

  // 재생 실패 시 안내 (유튜브가 스트림을 막는 경우 등)
  manager.on("trackError", (player, track, payload) => {
    console.error("🎵 재생 오류:", track?.info?.title, payload?.exception?.message);
    const ch = client.channels.cache.get(player.textChannelId);
    ch?.send(`⚠️ **${track?.info?.title ?? "곡"}** 을(를) 재생하지 못했어요. 다른 곡을 시도해 주세요.`).catch(() => {});
  });

  // 곡이 시작될 때마다 패널을 채팅창 맨 아래로 새로 보낸다
  manager.on("trackStart", async (player) => {
    const old = panels.get(player.guildId);
    panels.delete(player.guildId);
    old?.delete().catch(() => {});

    const ch = client.channels.cache.get(player.textChannelId);
    const payload = panelPayload(player);
    if (!ch || !payload) return;
    try {
      panels.set(player.guildId, await ch.send(payload));
    } catch (e) {
      console.error("🎵 패널 전송 실패:", e.message);
    }
  });

  // 큐 종료·퇴장 시 패널의 버튼을 제거
  manager.on("queueEnd", (player) => closePanel(player.guildId, "⏹️ 재생이 끝났어요"));
  manager.on("playerDestroy", (player, reason) =>
    closePanel(player.guildId, reason === "channelEmpty" ? "👋 아무도 없어서 나갔어요" : "⏹️ 재생을 멈췄어요"),
  );

  // 음성 채널에 사람이 없으면 퇴장
  client.on("voiceStateUpdate", (oldState) => {
    const player = manager.getPlayer(oldState.guild.id);
    if (!player?.voiceChannelId) return;
    const vc = oldState.guild.channels.cache.get(player.voiceChannelId);
    if (vc && vc.members.filter((m) => !m.user.bot).size === 0) {
      player.destroy("channelEmpty");
    }
  });

  client.on("raw", (d) => manager.sendRawData(d));
  client.once("clientReady", () => manager.init({ ...client.user }));
  return manager;
}

function getMusicManager() {
  return manager;
}

module.exports = { createMusicManager, getMusicManager, handleMusicButton, refreshPanel };
