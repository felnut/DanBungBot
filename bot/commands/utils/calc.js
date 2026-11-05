const { SlashCommandBuilder, MessageFlags } = require("discord.js");

const MAX_LENGTH = 200;
const MAX_DEPTH = 40;
const FUNCTIONS = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log10,
  ln: Math.log,
};
const CONSTANTS = { pi: Math.PI, 파이: Math.PI, e: Math.E };

/**
 * 수식을 직접 해석해서 계산한다 (eval을 쓰지 않는다).
 * 지원: + - * / % ^ ( ), 소수, 함수 sqrt abs round floor ceil sin cos tan log ln, 상수 pi e
 */
function evaluate(source) {
  const text = source
    .replace(/[×x]/g, "*")
    .replace(/÷/g, "/")
    .replace(/\s+/g, "")
    .toLowerCase();
  let pos = 0;
  let depth = 0;
  const fail = (msg) => {
    throw new Error(msg);
  };
  const peek = () => text[pos];

  function number() {
    const m = /^\d+(\.\d+)?|^\.\d+/.exec(text.slice(pos));
    if (!m) fail("숫자가 필요한 자리에 다른 글자가 있어요");
    pos += m[0].length;
    return parseFloat(m[0]);
  }

  function primary() {
    if (++depth > MAX_DEPTH) fail("괄호가 너무 깊어요");
    let value;
    const c = peek();
    if (c === "(") {
      pos++;
      value = additive();
      if (peek() !== ")") fail("괄호가 닫히지 않았어요");
      pos++;
    } else if (/[a-z가-힣]/.test(c ?? "")) {
      const m = /^[a-z가-힣]+/.exec(text.slice(pos));
      const name = m[0];
      pos += name.length;
      if (name in CONSTANTS) value = CONSTANTS[name];
      else if (name in FUNCTIONS && peek() === "(") {
        pos++;
        const arg = additive();
        if (peek() !== ")") fail("괄호가 닫히지 않았어요");
        pos++;
        value = FUNCTIONS[name](arg);
      } else fail(`알 수 없는 이름이에요: ${name}`);
    } else if (c === undefined) {
      fail("수식이 끝나버렸어요");
    } else {
      value = number();
    }
    depth--;
    return value;
  }

  function unary() {
    if (peek() === "-") {
      pos++;
      return -unary();
    }
    if (peek() === "+") {
      pos++;
      return unary();
    }
    return power();
  }

  function power() {
    const base = primary();
    if (peek() === "^") {
      pos++;
      return Math.pow(base, unary()); // 오른쪽부터 묶는다 (2^3^2 = 2^9)
    }
    return base;
  }

  function multiplicative() {
    let value = unary();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = text[pos++];
      const rhs = unary();
      if (op === "*") value *= rhs;
      else if (rhs === 0) fail("0으로 나눌 수 없어요");
      else value = op === "/" ? value / rhs : value % rhs;
    }
    return value;
  }

  function additive() {
    let value = multiplicative();
    while (peek() === "+" || peek() === "-") {
      value =
        text[pos++] === "+"
          ? value + multiplicative()
          : value - multiplicative();
    }
    return value;
  }

  const result = additive();
  if (pos < text.length)
    fail(`해석하지 못한 부분이 있어요: ${text.slice(pos, pos + 10)}`);
  if (!Number.isFinite(result)) fail("계산 결과가 너무 크거나 정의되지 않아요");
  return result;
}

/** 부동소수 오차를 줄여서 보기 좋게 만든다 */
function format(value) {
  const rounded = Number(value.toPrecision(12));
  if (Math.abs(rounded) >= 1e15 || (rounded !== 0 && Math.abs(rounded) < 1e-9))
    return rounded.toExponential(6);
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 10 });
}

module.exports = {
  evaluate,
  data: new SlashCommandBuilder()
    .setName("계산")
    .setDescription(
      "수식을 계산해줘요! (+ - * / % ^ 괄호, sqrt·abs·round 같은 함수)",
    )
    .addStringOption((o) =>
      o
        .setName("수식")
        .setDescription("예: (3+4)*2, 2^10, sqrt(144)")
        .setRequired(true)
        .setMaxLength(MAX_LENGTH),
    ),

  async execute(interaction) {
    const expr = interaction.options.getString("수식");
    try {
      const result = evaluate(expr);
      return interaction.reply(
        `🧮 \`${expr.replace(/`/g, "'")}\`\n= **${format(result)}**`,
      );
    } catch (err) {
      return interaction.reply({
        content: `❌ 계산하지 못했어요: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
