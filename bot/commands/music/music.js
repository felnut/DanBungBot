const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { getMusicManager, refreshPanel } = require("../../managers/musicManager");
const { resolveInput, applyMeta, ResolveError } = require("../../managers/linkResolver");

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("음악")
    .setDescription("음성 채널에서 음악 재생")
    .addSubcommand((s) =>
      s
        .setName("재생")
        .setDescription("검색어나 URL로 음악을 큐에 추가")
        .addStringOption((o) =>
          o.setName("검색어").setDescription("제목 또는 URL").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("소스")
            .setDescription("검색어일 때 찾을 곳 (링크는 자동 인식, 기본: 사운드클라우드)")
            .addChoices(
              { name: "사운드클라우드", value: "soundcloud" },
              { name: "유튜브", value: "youtube" },
            ),
        ),
    )
    .addSubcommand((s) => s.setName("일시정지").setDescription("일시정지/재개"))
    .addSubcommand((s) => s.setName("스킵").setDescription("현재 곡 건너뛰기"))
    .addSubcommand((s) => s.setName("정지").setDescription("재생 중지 및 퇴장"))
    .addSubcommand((s) => s.setName("큐").setDescription("대기열 보기")),

  async execute(interaction) {
    const manager = getMusicManager();
    const nodeUp = manager && [...manager.nodeManager.nodes.values()].some((n) => n.connected);
    if (!nodeUp) {
      return interaction.reply({
        content: "음악 서버(Lavalink)에 연결되어 있지 않아요.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();
    const vc = interaction.member.voice?.channel;
    if (!vc) {
      return interaction.reply({
        content: "먼저 음성 채널에 들어가 주세요.",
        flags: MessageFlags.Ephemeral,
      });
    }

    let player = manager.getPlayer(interaction.guildId);
    if (player && player.voiceChannelId !== vc.id) {
      return interaction.reply({
        content: "봇이 있는 음성 채널에서 사용해 주세요.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "재생") {
      await interaction.deferReply();
      const query = interaction.options.getString("검색어");
      const source = interaction.options.getString("소스") ?? "soundcloud";

      // 링크 검증 / 유튜브는 yt-dlp로 재생 주소 추출 (시간이 걸릴 수 있음)
      let resolved;
      try {
        resolved = await resolveInput(query, source);
      } catch (e) {
        if (e instanceof ResolveError) return interaction.editReply(e.userMessage);
        throw e;
      }
      if (!player) {
        player = manager.createPlayer({
          guildId: interaction.guildId,
          voiceChannelId: vc.id,
          textChannelId: interaction.channelId,
          selfDeaf: true,
        });
      }
      if (!player.connected) await player.connect();

      const res = await player.search({ query: resolved.identifier }, interaction.user);
      if (res.loadType === "error" || res.loadType === "empty" || !res.tracks.length) {
        if (!player.queue.current) await player.destroy();
        return interaction.editReply("검색 결과가 없거나 불러오지 못했어요.");
      }

      if (resolved.meta) applyMeta(res.tracks[0], resolved.meta);

      if (res.loadType === "playlist") {
        await player.queue.add(res.tracks);
        await interaction.editReply(
          `📃 플레이리스트 **${res.playlist?.title ?? ""}** ${res.tracks.length}곡 추가`,
        );
      } else {
        await player.queue.add(res.tracks[0]);
        await interaction.editReply(
          `➕ 큐에 추가: **${res.tracks[0].info.title}** (${fmt(res.tracks[0].info.duration)})`,
        );
      }
      if (!player.playing && !player.paused) await player.play();
      return;
    }

    if (!player) {
      return interaction.reply({
        content: "재생 중인 음악이 없어요.",
        flags: MessageFlags.Ephemeral,
      });
    }

    switch (sub) {
      case "일시정지":
        if (player.paused) await player.resume();
        else await player.pause();
        refreshPanel(player);
        return interaction.reply(player.paused ? "⏸️ 일시정지" : "▶️ 재개");
      case "스킵":
        await player.skip();
        return interaction.reply("⏭️ 건너뛰었어요.");
      case "정지":
        await player.destroy("stop");
        return interaction.reply("⏹️ 재생을 멈추고 나갔어요.");
      case "큐": {
        const cur = player.queue.current;
        if (!cur) {
          return interaction.reply({
            content: "재생 중인 곡이 없어요.",
            flags: MessageFlags.Ephemeral,
          });
        }
        const next = player.queue.tracks
          .slice(0, 10)
          .map((t, i) => `${i + 1}. ${t.info.title} (${fmt(t.info.duration)})`);
        const more = player.queue.tracks.length - 10;
        return interaction.reply(
          `🎶 **${cur.info.title}**\n${next.join("\n") || "대기열이 비어 있어요."}${more > 0 ? `\n… 외 ${more}곡` : ""}`,
        );
      }
    }
  },
};
