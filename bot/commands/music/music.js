const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { getMusicManager, refreshPanel } = require("../../managers/musicManager");
const { ResolveError } = require("../../managers/linkResolver");
const { prepareTrack, schedulePrefetch, prefetchNow, suggest, failed } = require("../../managers/musicPrep");

const DEFAULT_SOURCE = "youtube"; // 검색어일 때 기본으로 찾을 곳
const SUGGEST_DEBOUNCE_MS = 350; // 입력이 이만큼 멈췄을 때만 검색 (타자 입력마다 검색하지 않음)
const SUGGEST_TIMEOUT_MS = 2400; // 자동완성 응답 제한(3초)보다 약간 짧게
const suggestSeq = new Map(); // userId -> 가장 최근 자동완성 요청 번호

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
          o
            .setName("검색어")
            .setDescription("제목 또는 URL")
            .setRequired(true)
            .setAutocomplete(true), // 입력하는 동안 곡을 미리 준비해 재생을 빠르게 함
        )
        .addStringOption((o) =>
          o
            .setName("소스")
            .setDescription("검색어일 때 찾을 곳 (링크는 자동 인식, 기본: 유튜브)")
            .addChoices(
              { name: "유튜브", value: "youtube" },
              { name: "사운드클라우드", value: "soundcloud" },
            ),
        ),
    )
    .addSubcommand((s) => s.setName("일시정지").setDescription("일시정지/재개"))
    .addSubcommand((s) => s.setName("스킵").setDescription("현재 곡 건너뛰기"))
    .addSubcommand((s) => s.setName("정지").setDescription("재생 중지 및 퇴장"))
    .addSubcommand((s) => s.setName("큐").setDescription("대기열 보기")),

  // 검색어를 입력(붙여넣기)하는 동안 호출됨.
  //  - 링크: 곡을 미리 준비해 두고 입력값을 그대로 돌려준다
  //  - 검색어: 상위 5개 결과를 선택지로 보여 주고, 맨 위 결과를 미리 준비해 둔다
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (interaction.options.getSubcommand() !== "재생" || focused.name !== "검색어") {
      return interaction.respond([]);
    }
    const text = focused.value.trim();
    const source = interaction.options.getString("소스") ?? DEFAULT_SOURCE;
    const uid = interaction.user.id;
    const seq = (suggestSeq.get(uid) ?? 0) + 1;
    suggestSeq.set(uid, seq);
    const isStale = () => suggestSeq.get(uid) !== seq; // 그 사이 더 새로운 입력이 들어왔는가
    const reply = (choices) => interaction.respond(choices).catch(() => {}); // 만료된 자동완성 응답 실패는 무시

    if (/^https?:\/\//i.test(text)) {
      schedulePrefetch(uid, text, source);
      // 선택지 값은 100자 이하만 가능. 길면 비워 두면 입력한 그대로 제출된다.
      return reply(text.length <= 100 ? [{ name: text, value: text }] : []);
    }
    if (text.length < 2) return reply([]);

    // 타자 입력 중에는 검색하지 않도록 잠깐 기다렸다가, 그동안 새 입력이 없을 때만 검색한다
    await new Promise((r) => setTimeout(r, SUGGEST_DEBOUNCE_MS));
    if (isStale()) return reply([]);

    let choices = [];
    try {
      // 디스코드 자동완성은 3초 안에 응답해야 하므로 시간 제한을 둔다 (검색은 계속 진행되어 메모됨)
      choices = await Promise.race([
        suggest(text, source),
        new Promise((r) => setTimeout(() => r(null), SUGGEST_TIMEOUT_MS)),
      ]);
    } catch {
      choices = null;
    }
    if (isStale()) return reply([]);
    if (!choices) return reply(text.length <= 100 ? [{ name: `🔎 ${text}`.slice(0, 100), value: text }] : []);

    if (choices.length) prefetchNow(choices[0].value, source); // 맨 위 결과를 미리 준비 (엔터만 눌러도 빠르게)
    return reply(choices);
  },

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
      // "생각 중…" 표시 대신 즉시 실제 메시지로 응답하고, 결과가 나오면 이 메시지를 수정한다
      await interaction.reply("🔎 곡을 찾는 중…");
      const ackMs = Date.now() - interaction.createdTimestamp; // 명령 입력 후 응답까지 걸린 시간
      const startedAt = Date.now();
      if (ackMs > 800) console.warn(`⚠️ /음악 재생 응답이 느립니다: ${ackMs}ms`);
      const query = interaction.options.getString("검색어");
      const source = interaction.options.getString("소스") ?? DEFAULT_SOURCE;

      if (!player) {
        player = manager.createPlayer({
          guildId: interaction.guildId,
          voiceChannelId: vc.id,
          textChannelId: interaction.channelId,
          selfDeaf: true,
        });
      }

      // 음성 채널 접속과 곡 준비(해석 + Lavalink 로드)를 동시에 진행한다
      const connecting = player.connected ? Promise.resolve() : player.connect();
      const preparing = prepareTrack(query, source, interaction.user);
      connecting.catch(() => {}); // 한쪽이 먼저 실패해도 다른 쪽의 늦은 거절이 처리되지 않은 오류가 되지 않게
      preparing.catch(() => {});

      let prepared;
      try {
        [, prepared] = await Promise.all([connecting, preparing]);
      } catch (e) {
        if (!player.queue.current) await player.destroy().catch(() => {});
        if (e instanceof ResolveError) return interaction.editReply(e.userMessage);
        throw e;
      }

      const { res } = prepared;
      if (failed(res)) {
        if (!player.queue.current) await player.destroy();
        return interaction.editReply("검색 결과가 없거나 불러오지 못했어요.");
      }

      if (res.loadType === "playlist") {
        await player.queue.add(res.tracks);
      } else {
        await player.queue.add(res.tracks[0]);
      }
      // 재생 시작을 먼저 하고, 안내 메시지 수정은 기다리지 않는다 (소리가 나기까지의 시간을 줄임)
      const playing = !player.playing && !player.paused ? player.play() : Promise.resolve();
      const notice =
        res.loadType === "playlist"
          ? `📃 플레이리스트 **${res.playlist?.title ?? ""}** ${res.tracks.length}곡 추가`
          : `➕ 큐에 추가: **${res.tracks[0].info.title}** (${fmt(res.tracks[0].info.duration)})`;
      interaction.editReply(notice).catch(() => {});
      await playing;
      console.log(`🎵 /음악 재생 준비 ${Date.now() - startedAt}ms (응답 ${ackMs}ms 후, 총 ${Date.now() - interaction.createdTimestamp}ms)`);
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
