// 블랙잭 규칙 (순수 로직 — 시뮬레이션으로 환수율 검증 가능)
// • 6덱 슈, 매 판 새로 섞음. 플레이어는 히트/스탠드만 가능(더블·스플릿 없음). 딜러는 17 이상에서 멈춤.
// • 이기면 베팅의 1:1을 받되 승리금에서 수수료 COMMISSION을 뗀다. 블랙잭(처음 두 장 21)도 1:1(수수료 동일).
// • 최적 전략(히트/스탠드 기본 전략)으로 해도 환수율 약 94~95%, 일반 플레이어는 그보다 낮다.
const crypto = require("node:crypto");

const COMMISSION = 0.03;
const SUITS = ["♠", "♥", "♦", "♣"];

function newShoe(decks = 6) {
  const shoe = [];
  for (let d = 0; d < decks; d++)
    for (const s of SUITS) for (let r = 1; r <= 13; r++) shoe.push({ r, s });
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

const label = (c) =>
  `${{ 1: "A", 11: "J", 12: "Q", 13: "K" }[c.r] ?? c.r}${c.s}`;
const cardValue = (c) => Math.min(c.r, 10);

/** 손패 합계. A는 11로 쳐도 21을 넘지 않으면 11 (soft) */
function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    total += cardValue(c);
    if (c.r === 1) aces++;
  }
  let soft = false;
  if (aces && total + 10 <= 21) {
    total += 10;
    soft = true;
  }
  return { total, soft };
}

const isBlackjack = (hand) => hand.length === 2 && handValue(hand).total === 21;

function dealerPlay(shoe, dealer) {
  while (handValue(dealer).total < 17) dealer.push(shoe.pop());
  return dealer;
}

/**
 * 정산 배율(원금 포함). 0 = 전액 손실, 1 = 무승부(원금 반환), 그 외 = 승리
 * @returns {{mult:number, result:"win"|"lose"|"push", reason:string}}
 */
function settle(player, dealer) {
  const win = { mult: 2 - COMMISSION, result: "win" };
  const p = handValue(player).total;
  const d = handValue(dealer).total;
  if (isBlackjack(player)) {
    return isBlackjack(dealer)
      ? { mult: 1, result: "push", reason: "둘 다 블랙잭" }
      : { ...win, reason: "블랙잭!" };
  }
  if (isBlackjack(dealer))
    return { mult: 0, result: "lose", reason: "딜러 블랙잭" };
  if (p > 21) return { mult: 0, result: "lose", reason: "버스트" };
  if (d > 21) return { ...win, reason: "딜러 버스트" };
  if (p > d) return { ...win, reason: "숫자가 더 커요" };
  if (p === d) return { mult: 1, result: "push", reason: "비겼어요" };
  return { mult: 0, result: "lose", reason: "딜러가 더 커요" };
}

/** 베팅액에 대한 실제 지급액 (원 단위 내림) */
const payoutOf = (bet, mult) => Math.floor(bet * mult);

module.exports = {
  COMMISSION,
  newShoe,
  label,
  handValue,
  isBlackjack,
  dealerPlay,
  settle,
  payoutOf,
};
