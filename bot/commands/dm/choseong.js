const { SlashCommandBuilder, InteractionContextType } = require("discord.js");
const crypto = require("node:crypto");
const { runGuessGame } = require("../../managers/dmGuessGame");

const MAX_TRIES = 3;

// [분류, 낱말] — 분류를 힌트로 보여 준다
const WORDS = [
  ["음식", "떡볶이"],
  ["음식", "김치찌개"],
  ["음식", "비빔밥"],
  ["음식", "삼각김밥"],
  ["음식", "초콜릿"],
  ["음식", "아이스크림"],
  ["음식", "햄버거"],
  ["음식", "라면"],
  ["동물", "고슴도치"],
  ["동물", "카멜레온"],
  ["동물", "다람쥐"],
  ["동물", "코끼리"],
  ["동물", "오랑우탄"],
  ["동물", "알파카"],
  ["동물", "펭귄"],
  ["동물", "하마"],
  ["장소", "도서관"],
  ["장소", "놀이공원"],
  ["장소", "수영장"],
  ["장소", "편의점"],
  ["장소", "경복궁"],
  ["장소", "지하철역"],
  ["장소", "운동장"],
  ["장소", "박물관"],
  ["학교", "체육대회"],
  ["학교", "급식실"],
  ["학교", "수학여행"],
  ["학교", "방학숙제"],
  ["학교", "졸업앨범"],
  ["학교", "매점"],
  ["학교", "시험기간"],
  ["학교", "교과서"],
  ["물건", "우산"],
  ["물건", "에어컨"],
  ["물건", "보조배터리"],
  ["물건", "이어폰"],
  ["물건", "필통"],
  ["물건", "선풍기"],
  ["물건", "텀블러"],
  ["물건", "리모컨"],
  ["취미", "보드게임"],
  ["취미", "캠핑"],
  ["취미", "사진촬영"],
  ["취미", "자전거"],
  ["취미", "뜨개질"],
  ["취미", "노래방"],
  ["취미", "독서"],
  ["취미", "산책"],
  ["자연", "무지개"],
  ["자연", "은하수"],
  ["자연", "소나기"],
  ["자연", "단풍"],
  ["자연", "반딧불이"],
  ["자연", "폭포"],
  ["자연", "해돋이"],
  ["자연", "눈사람"],
];

const BASE = 0xac00;
const CHOSEONG = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];
/** 한글 낱말의 초성만 뽑는다 */
const toChoseong = (word) =>
  [...word]
    .map((ch) => {
      const code = ch.charCodeAt(0) - BASE;
      return code >= 0 && code <= 11171 ? CHOSEONG[Math.floor(code / 588)] : ch;
    })
    .join("");

module.exports = {
  toChoseong,
  WORDS,
  data: new SlashCommandBuilder()
    .setName("초성퀴즈")
    .setDescription("초성을 보고 낱말을 맞혀 보세요 (DM 전용)")
    .setContexts(InteractionContextType.BotDM),

  async execute(interaction) {
    const [category, word] = WORDS[crypto.randomInt(WORDS.length)];
    const hint = toChoseong(word);
    return runGuessGame(interaction, {
      title: "🔤 초성 퀴즈",
      intro: `분류: **${category}**\n초성: # ${hint.split("").join(" ")}\n\n**${MAX_TRIES}번** 안에 낱말을 맞혀 보세요! (${word.length}글자)`,
      maxTries: MAX_TRIES,
      inputLabel: "정답",
      placeholder: `${word.length}글자 낱말`,
      maxLength: 20,
      judge(input, wrong) {
        const guess = input.replace(/\s+/g, "");
        if (guess === word) return { correct: true, text: "🎯 정답!" };
        // 처음 틀리면 첫 글자를 알려 준다
        const extra = wrong === 0 ? ` (첫 글자는 **${word[0]}**)` : "";
        return { correct: false, text: `❌ 아니에요${extra}` };
      },
      reveal: () => word,
    });
  },
};
