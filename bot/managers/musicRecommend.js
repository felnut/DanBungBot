// 음악 추천: 서버 운영자가 등록한 사이트의 곡 중에서 무작위로 골라 보여주고, 버튼으로 바로 재생한다.
// 자동 추천(기본 꺼짐)을 켜면 재생 대기열이 끝났을 때 추천 목록을 채팅에 올린다. 사용자 정보는 저장하지 않는다.
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} = require("discord.js");
const db = require("../../Database");
const { getMusicManager, safeText } = require("./musicManager");
const {
  fetchTracks,
  SourceError,
  defaultSources,
} = require("./recommendSources");

const MAX_SOURCES = 5; // 서버당 등록할 수 있는 사이트 수
const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;
const BUTTON_TIME_MS = 10 * 60 * 1000; // 추천 메시지의 버튼이 동작하는 시간
const AUTO_COOLDOWN_MS = 10 * 60 * 1000; // 자동 추천은 서버당 10분에 한 번까지
const RECENT_KEEP = 200; // 서버별로 최근 추천한 곡을 기억해 같은 곡이 또 나오지 않게 한다

const EPHEMERAL = MessageFlags.Ephemeral;

class RecError extends Error {
  constructor(userMessage) {
    super(userMessage);
    this.userMessage = userMessage;
  }
}

// ---------- 설정 저장 ----------
const stmtCfgGet = db.prepare(
  "SELECT enabled FROM music_rec_config WHERE guild_id = ?",
);
const stmtCfgSet = db.prepare(
  "INSERT INTO music_rec_config (guild_id, enabled, updated_at) VALUES (?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at",
);
const stmtSrcList = db.prepare(
  "SELECT id, kind, url, label FROM music_rec_source WHERE guild_id = ? ORDER BY id ASC",
);
const stmtSrcCount = db.prepare(
  "SELECT COUNT(*) AS n FROM music_rec_source WHERE guild_id = ?",
);
const stmtSrcAdd = db.prepare(
  "INSERT OR IGNORE INTO music_rec_source (guild_id, kind, url, label, added_at) VALUES (?, ?, ?, ?, ?)",
);
const stmtSrcDel = db.prepare(
  "DELETE FROM music_rec_source WHERE guild_id = ? AND id = ?",
);

const isEnabled = (guildId) => Boolean(stmtCfgGet.get(guildId)?.enabled);
const setEnabled = (guildId, on) =>
  stmtCfgSet.run(guildId, on ? 1 : 0, Date.now());
const listSources = (guildId) => stmtSrcList.all(guildId);

/** 추천에 실제로 쓰는 사이트: 서버 운영자가 등록한 사이트, 하나도 없으면 기본 사이트 */
function activeSources(guildId) {
  const own = listSources(guildId);
  return own.length
    ? { sources: own, isDefault: false }
    : { sources: defaultSources(), isDefault: true };
}

/** 사이트 추가. 결과: "added" | "duplicate" | "full" */
const addSource = db.transaction((guildId, parsed) => {
  if (stmtSrcCount.get(guildId).n >= MAX_SOURCES) return "full";
  return stmtSrcAdd.run(
    guildId,
    parsed.kind,
    parsed.url,
    parsed.label,
    Date.now(),
  ).changes
    ? "added"
    : "duplicate";
});

/** 목록의 번호(1부터)로 사이트를 지운다. 지운 사이트를 돌려주고, 없으면 null */
function removeSourceAt(guildId, number) {
  const target = listSources(guildId)[number - 1];
  if (!target) return null;
  stmtSrcDel.run(guildId, target.id);
  return target;
}

// ---------- 추천 고르기 ----------
const recent = new Map(); // guildId -> Set(곡 키)
const keyOf = (t) =>
  `${t.artist}|${t.title}`.toLowerCase().replace(/\s+/g, " ");

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 등록된 사이트들의 곡을 모아 무작위로 count곡을 고른다. 문제가 있으면 RecError */
async function pickRecommendations(guildId, count = DEFAULT_COUNT) {
  const { sources } = activeSources(guildId);
  const results = await Promise.allSettled(sources.map((s) => fetchTracks(s)));
  const pool = [];
  const seen = new Set();
  let lastError = null;
  for (const r of results) {
    if (r.status === "rejected") {
      lastError = r.reason;
      continue;
    }
    for (const t of r.value) {
      const k = keyOf(t);
      if (!seen.has(k)) {
        seen.add(k);
        pool.push(t);
      }
    }
  }
  if (!pool.length) {
    throw new RecError(
      lastError instanceof SourceError
        ? `🎧 ${lastError.userMessage}`
        : "🎧 등록된 사이트에서 곡을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  }

  const used = recent.get(guildId) ?? new Set();
  let candidates = pool.filter((t) => !used.has(keyOf(t)));
  if (candidates.length < count) {
    used.clear(); // 가져온 곡을 거의 다 추천했다면 처음부터 다시
    candidates = pool;
  }
  const picked = shuffle(candidates).slice(0, count);
  for (const t of picked) used.add(keyOf(t));
  while (used.size > RECENT_KEEP) used.delete(used.values().next().value);
  recent.set(guildId, used);
  return picked;
}

// ---------- 글 만들기 (코드 블록 안의 일반 텍스트) ----------
const CHART_SIZE = 10;
const MESSAGE_LIMIT = 1900; // 디스코드 글자 수 제한(2000)보다 여유 있게

/** 코드 블록 안에 넣을 글: 제어문자를 없애고, 블록을 끊는 backtick은 바꾸고, 길이를 제한한다 */
const plain = (s, max) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/`/g, "’")
    .trim()
    .slice(0, max);
const codeBlock = (lines) => `\`\`\`\n${lines.join("\n")}\n\`\`\``;

/** "1. 노래 제목 - 가수" (가수를 모르면 제목만) */
const trackLine = (t, rank, suffix = "") =>
  `${rank}. ${plain(t.title, 70)}${t.artist ? ` - ${plain(t.artist, 40)}` : ""}${suffix}`;

/**
 * /음악추천 차트: 추천에 쓰는 사이트(등록한 사이트, 없으면 기본 사이트)마다 TOP 10을 만든다.
 * 카테고리 제목 아래에 "사이트 TOP 10" 코드 블록을 두고, 목록의 앞쪽부터가 순위다.
 * 글자 수 제한을 넘지 않게 여러 개의 메시지로 나눈다. 못 가져온 사이트는 그 사실만 적는다.
 * @returns {Promise<string[]>} 보낼 메시지들
 */
async function buildChartMessages(guildId) {
  const { sources, isDefault } = activeSources(guildId);
  const results = await Promise.allSettled(sources.map((s) => fetchTracks(s)));
  const blocks = sources.map((s, i) => {
    const r = results[i];
    const name = isDefault ? s.label : `${s.label} (${i + 1}번 사이트)`;
    const lines =
      r.status === "rejected" || !r.value.length
        ? ["목록을 불러오지 못했어요."]
        : r.value.slice(0, CHART_SIZE).map((t, k) => trackLine(t, k + 1));
    return {
      category: s.category ?? "서버 등록 사이트",
      text: codeBlock([`${plain(name, 60)} TOP ${CHART_SIZE}`, ...lines]),
    };
  });

  // 카테고리마다 따로 보낸다: 한국은 한국끼리, 글로벌은 글로벌끼리 묶고 서로 다른 메시지로 나눈다.
  // 한 카테고리가 글자 수 제한을 넘으면 그 안에서만 나누고, 나뉜 메시지에도 카테고리 제목을 다시 붙인다
  const order = [...new Set(blocks.map((b) => b.category))];
  const messages = [];
  for (const category of order) {
    const head = `**${category}**\n`;
    let current = "";
    for (const b of blocks.filter((x) => x.category === category)) {
      if (current && current.length + 1 + b.text.length > MESSAGE_LIMIT) {
        messages.push(current);
        current = "";
      }
      current = current ? `${current}\n${b.text}` : head + b.text;
    }
    if (current) messages.push(current);
  }
  return messages;
}

// ---------- 메시지와 버튼 ----------
/**
 * /음악 추천받기: "1. 노래 제목 - 가수 - 어디" 목록(코드 블록)과 재생 버튼.
 * header가 있으면 목록 위에 한 줄 덧붙인다 (자동 추천용)
 */
function buildMessage(tracks, header = null) {
  const lines = tracks.map((t, i) =>
    trackLine(t, i + 1, ` - ${plain(t.source, 40)}`),
  );
  const content = `${header ? `${header}\n` : ""}${codeBlock(lines)}`;

  const rows = [];
  for (let i = 0; i < tracks.length; i += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        tracks.slice(i, i + 5).map((_, j) =>
          new ButtonBuilder()
            .setCustomId(`musicrec:${i + j}`)
            .setLabel(`▶ ${i + j + 1}`)
            .setStyle(ButtonStyle.Secondary),
        ),
      ),
    );
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("musicrec:all")
        .setLabel("전부 대기열에 추가")
        .setStyle(ButtonStyle.Primary),
    ),
  );
  return { content, components: rows, allowedMentions: { parse: [] } };
}

/** 추천 곡 하나를 대기열에 넣는다. 못 찾으면 false */
async function enqueue(player, user, track) {
  const { prepareTrack, failed } = require("./musicPrep"); // musicPrep이 musicManager를 쓰므로 필요할 때 불러온다
  const query = track.url ?? `${track.artist} ${track.title}`.trim();
  let prepared;
  try {
    prepared = await prepareTrack(query, "youtube", user);
  } catch {
    return false;
  }
  if (failed(prepared.res)) return false;
  await player.queue.add(prepared.res.tracks[0]);
  return true;
}

/** 버튼 클릭 처리: 누른 사람이 있는 음성 채널에서 재생한다 */
async function handleClick(i, tracks) {
  const manager = getMusicManager();
  const nodeUp =
    manager && [...manager.nodeManager.nodes.values()].some((n) => n.connected);
  if (!nodeUp)
    return i.reply({
      content: "음악 서버(Lavalink)에 연결되어 있지 않아요.",
      flags: EPHEMERAL,
    });
  const vc = i.member?.voice?.channel;
  if (!vc)
    return i.reply({
      content: "먼저 음성 채널에 들어가 주세요.",
      flags: EPHEMERAL,
    });
  let player = manager.getPlayer(i.guildId);
  if (player && player.voiceChannelId !== vc.id) {
    return i.reply({
      content: "봇이 있는 음성 채널에서 눌러 주세요.",
      flags: EPHEMERAL,
    });
  }

  const wanted =
    i.customId === "musicrec:all"
      ? tracks
      : [tracks[Number(i.customId.split(":")[1])]].filter(Boolean);
  if (!wanted.length)
    return i.reply({ content: "이미 만료된 추천이에요.", flags: EPHEMERAL });
  await i.deferReply({ flags: EPHEMERAL });

  if (!player) {
    player = manager.createPlayer({
      guildId: i.guildId,
      voiceChannelId: vc.id,
      textChannelId: i.channelId,
      selfDeaf: true,
    });
  }
  try {
    if (!player.connected) await player.connect();
  } catch {
    if (!player.queue.current) await player.destroy().catch(() => {});
    return i.editReply(
      "음성 채널에 들어가지 못했어요. 봇 권한을 확인해 주세요.",
    );
  }

  let added = 0;
  for (const t of wanted) {
    if (await enqueue(player, i.user, t)) {
      added += 1;
      if (added === 1 && !player.playing && !player.paused)
        player.play().catch(() => {}); // 첫 곡이 준비되면 바로 재생
    }
  }
  if (!added) {
    if (!player.queue.current) await player.destroy().catch(() => {});
    return i.editReply("곡을 찾지 못했어요. 다른 곡을 눌러 보세요.");
  }
  return i.editReply(
    wanted.length === 1
      ? `➕ 큐에 추가: **${safeText(wanted[0].title, 80)}**`
      : `➕ ${wanted.length}곡 중 ${added}곡을 큐에 추가했어요.`,
  );
}

/** 추천 메시지에 버튼 처리를 붙인다 (10분 뒤 버튼 제거) */
function attachButtons(message, tracks) {
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: BUTTON_TIME_MS,
  });
  collector.on("collect", (i) => {
    handleClick(i, tracks).catch((e) => {
      console.error("🎧 추천 재생 오류:", e?.message);
      if (i.deferred || i.replied)
        i.editReply("재생하지 못했어요.").catch(() => {});
      else
        i.reply({ content: "재생하지 못했어요.", flags: EPHEMERAL }).catch(
          () => {},
        );
    });
  });
  collector.on("end", () => message.edit({ components: [] }).catch(() => {}));
}

// ---------- 자동 추천 ----------
const autoLast = new Map(); // guildId -> 마지막 자동 추천 시각

/** 재생 대기열이 끝났을 때 호출된다. 자동 추천이 켜져 있으면 추천 목록을 채팅에 올린다 */
async function onQueueEnd(client, player) {
  const guildId = player.guildId;
  if (!isEnabled(guildId)) return;
  if (Date.now() - (autoLast.get(guildId) ?? 0) < AUTO_COOLDOWN_MS) return;
  const channel = client.channels.cache.get(player.textChannelId);
  if (!channel) return;
  autoLast.set(guildId, Date.now());
  let tracks;
  try {
    tracks = await pickRecommendations(guildId, DEFAULT_COUNT);
  } catch {
    return; // 자동 추천은 조용히 건너뛴다
  }
  const message = await channel
    .send(
      buildMessage(
        tracks,
        "🎧 다음에 들을 만한 곡 (자동 추천) — 버튼을 누르면 재생돼요",
      ),
    )
    .catch(() => null);
  if (message) attachButtons(message, tracks);
}

module.exports = {
  RecError,
  MAX_SOURCES,
  DEFAULT_COUNT,
  MAX_COUNT,
  isEnabled,
  setEnabled,
  listSources,
  activeSources,
  addSource,
  removeSourceAt,
  pickRecommendations,
  buildChartMessages,
  buildMessage,
  attachButtons,
  onQueueEnd,
};
