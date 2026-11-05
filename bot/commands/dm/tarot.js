const {
  SlashCommandBuilder,
  InteractionContextType,
  EmbedBuilder,
} = require("discord.js");
const crypto = require("node:crypto");

// 메이저 아르카나 22장: [이름, 이모지, 정방향, 역방향]
const CARDS = [
  [
    "바보",
    "🃏",
    "새로운 시작과 모험. 겁내지 말고 한 걸음 내디뎌 보세요.",
    "무모함 주의. 한 번 더 확인하고 움직여요.",
  ],
  [
    "마법사",
    "🪄",
    "재능과 집중력이 빛나요. 가진 것으로 충분히 해낼 수 있어요.",
    "산만함. 하고 싶은 일을 하나로 좁혀 봐요.",
  ],
  [
    "여사제",
    "🌙",
    "직감을 믿을 때예요. 조용히 관찰하면 답이 보여요.",
    "속마음을 숨기고 있진 않나요? 솔직해져 봐요.",
  ],
  [
    "여황제",
    "👑",
    "풍요와 돌봄. 마음이 넉넉해지는 하루예요.",
    "과한 걱정이나 간섭. 나를 먼저 챙겨요.",
  ],
  [
    "황제",
    "🏛️",
    "안정과 책임감. 계획대로 밀고 나가기 좋아요.",
    "고집이 세질 수 있어요. 한 발 물러서 봐요.",
  ],
  [
    "교황",
    "📜",
    "배움과 조언. 믿을 만한 사람의 말에 귀 기울여요.",
    "틀에 박힌 생각에서 벗어날 때예요.",
  ],
  [
    "연인",
    "💞",
    "좋은 관계와 선택. 마음이 이끄는 쪽이 맞아요.",
    "엇갈림. 대화로 오해를 풀어요.",
  ],
  [
    "전차",
    "🏇",
    "추진력과 승리. 목표를 향해 달려가요.",
    "방향을 잃기 쉬워요. 속도를 줄여 봐요.",
  ],
  [
    "힘",
    "🦁",
    "부드러운 용기. 차분함이 가장 센 힘이에요.",
    "자신감이 흔들려요. 작은 성공부터 쌓아요.",
  ],
  [
    "은둔자",
    "🕯️",
    "혼자만의 시간이 필요해요. 생각을 정리해 봐요.",
    "너무 혼자 있었나요? 주변에 말을 걸어 봐요.",
  ],
  [
    "운명의 수레바퀴",
    "🎡",
    "흐름이 바뀌어요. 뜻밖의 좋은 기회가 올 수 있어요.",
    "타이밍이 안 맞아요. 조급해하지 말아요.",
  ],
  [
    "정의",
    "⚖️",
    "공정한 결과. 한 일만큼 돌아와요.",
    "치우친 판단 주의. 양쪽 이야기를 들어 봐요.",
  ],
  [
    "매달린 사람",
    "🙃",
    "잠시 멈추고 다른 시각으로 보면 길이 열려요.",
    "헛된 기다림. 이제는 결정할 때예요.",
  ],
  [
    "죽음",
    "🌅",
    "끝은 곧 새 출발. 정리하면 가벼워져요.",
    "미련이 남았어요. 놓아주면 편해져요.",
  ],
  ["절제", "🧪", "균형과 조화. 적당함이 답이에요.", "무리한 일정. 쉬어 가요."],
  [
    "악마",
    "😈",
    "유혹이나 습관에 끌려요. 무엇에 묶였는지 돌아봐요.",
    "벗어나는 중이에요. 조금만 더 힘내요.",
  ],
  [
    "탑",
    "⚡",
    "갑작스러운 변화. 무너져야 새로 지을 수 있어요.",
    "큰 일은 피했어요. 조심하면 괜찮아요.",
  ],
  [
    "별",
    "⭐",
    "희망과 회복. 바라던 일이 서서히 다가와요.",
    "의욕이 떨어졌어요. 작은 즐거움을 찾아봐요.",
  ],
  [
    "달",
    "🌕",
    "불안과 착각. 확실하지 않은 건 잠시 두세요.",
    "안개가 걷혀요. 진실이 드러나요.",
  ],
  [
    "태양",
    "☀️",
    "기쁨과 성공. 모든 게 환하게 풀려요.",
    "조금 흐린 날. 그래도 곧 갤 거예요.",
  ],
  [
    "심판",
    "📯",
    "다시 일어설 기회. 마음의 부름에 답해요.",
    "자책은 그만. 지난 일은 배움이었어요.",
  ],
  [
    "세계",
    "🌍",
    "완성과 마무리. 한 단계를 멋지게 끝냈어요.",
    "거의 다 왔어요. 마지막 한 조각이 남았어요.",
  ],
];

/** 오늘(KST) 날짜와 사용자로 같은 카드가 나오게 하는 시드 */
function dailyIndex(userId, dayStr) {
  return crypto
    .createHash("sha256")
    .update(`${userId}:${dayStr}`)
    .digest()
    .readUInt32BE(0);
}
const kstDay = () =>
  new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

function draw(count) {
  const picked = [];
  while (picked.length < count) {
    const i = crypto.randomInt(CARDS.length);
    if (!picked.some((p) => p.i === i))
      picked.push({ i, reversed: crypto.randomInt(2) === 1 });
  }
  return picked;
}
const line = ({ i, reversed }) => {
  const [name, emoji, up, down] = CARDS[i];
  return `${emoji} **${name}${reversed ? " (역방향)" : ""}**\n${reversed ? down : up}`;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("타로")
    .setDescription("타로 카드를 뽑아 봐요 (재미로만 봐 주세요, DM 전용)")
    .setContexts(InteractionContextType.BotDM)
    .addStringOption((o) =>
      o
        .setName("종류")
        .setDescription("비워 두면 오늘의 카드")
        .addChoices(
          { name: "오늘의 카드 (하루 동안 같은 카드)", value: "today" },
          { name: "과거·현재·미래 3장", value: "three" },
        ),
    ),

  async execute(interaction) {
    const kind = interaction.options.getString("종류") ?? "today";
    const embed = new EmbedBuilder().setColor(0x9b59b6);

    if (kind === "three") {
      const [past, now, future] = draw(3);
      embed
        .setTitle("🔮 타로 3장 뽑기")
        .addFields(
          { name: "과거", value: line(past) },
          { name: "현재", value: line(now) },
          { name: "미래", value: line(future) },
        );
    } else {
      const seed = dailyIndex(interaction.user.id, kstDay());
      const card = {
        i: seed % CARDS.length,
        reversed: Math.floor(seed / CARDS.length) % 2 === 1,
      };
      embed.setTitle("🔮 오늘의 타로").setDescription(line(card));
    }
    return interaction.reply({
      embeds: [
        embed.setFooter({
          text: "재미로 보는 타로예요. 실제 결정은 스스로 내려요!",
        }),
      ],
    });
  },
};
