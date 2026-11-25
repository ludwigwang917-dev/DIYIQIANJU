import type { AggName, Expr, FnName, Rule, RuleBet, RuleStrategy } from "./types.ts";

/**
 * The formula language of the strategy editor. Chinese or English names, e.g.
 *   如果(dealer.streak.length >= 3 且 dealer.streak.outcome == "win", 50, 10)
 *   计数(history, 10, it.dealerDelta > 0)
 * Formulas are parsed into the JSON expression tree (types.ts) and printed back from it,
 * so the block view and the formula view always edit the same thing.
 */

export class FormulaError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.position = position;
  }
}

/** Plain functions: formula names → tree function. min/max accept 2 or more arguments. */
const FUNCTIONS: Record<string, { fn: FnName; arity: number | "2+" }> = {
  如果: { fn: "if", arity: 3 },
  if: { fn: "if", arity: 3 },
  最小: { fn: "min", arity: "2+" },
  min: { fn: "min", arity: "2+" },
  最大: { fn: "max", arity: "2+" },
  max: { fn: "max", arity: "2+" },
  幂: { fn: "pow", arity: 2 },
  pow: { fn: "pow", arity: 2 },
  绝对值: { fn: "abs", arity: 1 },
  abs: { fn: "abs", arity: 1 },
  取整: { fn: "floor", arity: 1 },
  floor: { fn: "floor", arity: 1 },
  为空: { fn: "isnull", arity: 1 },
  isnull: { fn: "isnull", arity: 1 },
};

/** List statistics: (list, last N, value?, where?). */
const AGGREGATES: Record<string, AggName> = {
  计数: "count",
  count: "count",
  求和: "sum",
  sum: "sum",
  平均: "avg",
  avg: "avg",
  最大值: "max",
  maxof: "max",
  最小值: "min",
  minof: "min",
  存在: "any",
  any: "any",
};

const AGG_PRINT: Record<AggName, string> = {
  count: "计数",
  sum: "求和",
  avg: "平均",
  max: "最大值",
  min: "最小值",
  any: "存在",
};

const FN_PRINT: Partial<Record<FnName, string>> = {
  if: "如果",
  min: "最小",
  max: "最大",
  pow: "幂",
  abs: "绝对值",
  floor: "取整",
  isnull: "为空",
};

/** Does this statistic take a value expression (sum/avg/max/min) or only a condition (count/any)? */
export function aggTakesValue(agg: AggName) {
  return agg !== "count" && agg !== "any";
}

const KEYWORDS = ["且", "或", "非", "真", "假", "当", "时", "否则"];
const CJK = /[㐀-鿿]/;

type Token =
  | { t: "num"; value: number; pos: number }
  | { t: "str"; value: string; pos: number }
  | { t: "name"; value: string; pos: number }
  | { t: "op"; value: string; pos: number }
  | { t: "end"; pos: number };

const OPERATORS = [">=", "<=", "==", "!=", "&&", "||", "≥", "≤", "≠", ">", "<", "=", "+", "-", "*", "/", "×", "÷", "!", "(", ")", "（", "）", ",", "，", ".", ":", "：", ";", "；"];

function tokenize(source: string, extraWords: string[] = []): Token[] {
  // Chinese has no spaces between words, so Chinese words are matched from a known list,
  // longest first ("否则" before "否", "最大值" before "最大").
  const words = [...KEYWORDS, ...Object.keys(FUNCTIONS), ...Object.keys(AGGREGATES), ...extraWords]
    .filter((word) => CJK.test(word))
    .sort((a, b) => b.length - a.length);
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const match = /^[0-9]+(\.[0-9]+)?/.exec(source.slice(i))!;
      tokens.push({ t: "num", value: Number(match[0]), pos: i });
      i += match[0].length;
      continue;
    }
    if (ch === '"' || ch === "“" || ch === "「") {
      const close = ch === '"' ? '"' : ch === "“" ? "”" : "」";
      let j = i + 1;
      let text = "";
      while (j < source.length && source[j] !== close) {
        if (source[j] === "\\" && close === '"' && j + 1 < source.length) j += 1;
        text += source[j];
        j += 1;
      }
      if (j >= source.length) throw new FormulaError("引号没有配对", i);
      tokens.push({ t: "str", value: text, pos: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))!;
      tokens.push({ t: "name", value: match[0], pos: i });
      i += match[0].length;
      continue;
    }
    if (CJK.test(ch)) {
      const word = words.find((item) => source.startsWith(item, i));
      if (!word) {
        let j = i;
        while (j < source.length && CJK.test(source[j])) j += 1;
        throw new FormulaError(`看不懂「${source.slice(i, j)}」`, i);
      }
      tokens.push({ t: "name", value: word, pos: i });
      i += word.length;
      continue;
    }
    const op = OPERATORS.find((item) => source.startsWith(item, i));
    if (!op) throw new FormulaError(`看不懂符号「${ch}」`, i);
    tokens.push({ t: "op", value: op, pos: i });
    i += op.length;
  }
  tokens.push({ t: "end", pos: source.length });
  return tokens;
}

const NORMALIZE: Record<string, string> = {
  "≥": ">=",
  "≤": "<=",
  "≠": "!=",
  "=": "==",
  "×": "*",
  "÷": "/",
  "（": "(",
  "）": ")",
  "，": ",",
  "：": ":",
  "；": ";",
  "&&": "且",
  "||": "或",
  "!": "非",
};

class Parser {
  private index = 0;
  private readonly tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek(): Token {
    return this.tokens[this.index];
  }

  private text(token: Token): string | null {
    if (token.t === "op") return NORMALIZE[token.value] ?? token.value;
    if (token.t === "name") {
      const lower = token.value.toLowerCase();
      if (lower === "and") return "且";
      if (lower === "or") return "或";
      if (lower === "not") return "非";
      return token.value;
    }
    return null;
  }

  is(value: string): boolean {
    return this.text(this.peek()) === value;
  }

  take(value: string): boolean {
    if (!this.is(value)) return false;
    this.index += 1;
    return true;
  }

  expect(value: string, what = `「${value}」`) {
    if (!this.take(value)) throw new FormulaError(`这里应该是${what}`, this.peek().pos);
  }

  next(): Token {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }

  atEnd() {
    return this.peek().t === "end";
  }

  expression(): Expr {
    return this.or();
  }

  private or(): Expr {
    let left = this.and();
    while (this.take("或")) left = { f: "or", a: [left, this.and()] };
    return left;
  }

  private and(): Expr {
    let left = this.not();
    while (this.take("且")) left = { f: "and", a: [left, this.not()] };
    return left;
  }

  private not(): Expr {
    if (this.take("非")) return { f: "not", a: [this.not()] };
    return this.comparison();
  }

  private comparison(): Expr {
    const left = this.additive();
    const ops: Record<string, FnName> = { ">": "gt", ">=": "ge", "<": "lt", "<=": "le", "==": "eq", "!=": "ne" };
    const symbol = this.text(this.peek());
    if (symbol && ops[symbol]) {
      this.next();
      const right = this.additive();
      const after = this.text(this.peek());
      if (after && ops[after]) {
        throw new FormulaError("比较不能连着写，请用「且」分开", this.peek().pos);
      }
      return { f: ops[symbol], a: [left, right] };
    }
    return left;
  }

  private additive(): Expr {
    let left = this.multiplicative();
    for (;;) {
      if (this.take("+")) left = { f: "add", a: [left, this.multiplicative()] };
      else if (this.take("-")) left = { f: "sub", a: [left, this.multiplicative()] };
      else return left;
    }
  }

  private multiplicative(): Expr {
    let left = this.unary();
    for (;;) {
      if (this.take("*")) left = { f: "mul", a: [left, this.unary()] };
      else if (this.take("/")) left = { f: "div", a: [left, this.unary()] };
      else return left;
    }
  }

  private unary(): Expr {
    if (this.take("-")) {
      const inner = this.unary();
      return "n" in inner ? { n: -inner.n } : { f: "neg", a: [inner] };
    }
    return this.primary();
  }

  private path(first: string): string {
    const parts = [first];
    while (this.take(".")) {
      const token = this.next();
      if (token.t !== "name" || CJK.test(token.value)) {
        throw new FormulaError("「.」后面应该是英文字段名", token.pos);
      }
      parts.push(token.value);
    }
    return parts.join(".");
  }

  private primary(): Expr {
    const token = this.peek();
    if (token.t === "num") {
      this.next();
      return { n: token.value };
    }
    if (token.t === "str") {
      this.next();
      return { s: token.value };
    }
    if (this.take("(")) {
      const inner = this.expression();
      this.expect(")", "右括号「)」");
      return inner;
    }
    if (token.t === "name") {
      const name = token.value;
      const lower = name.toLowerCase();
      if (name === "真" || lower === "true") {
        this.next();
        return { b: true };
      }
      if (name === "假" || lower === "false") {
        this.next();
        return { b: false };
      }
      const fn = FUNCTIONS[name] ?? FUNCTIONS[lower];
      const agg = AGGREGATES[name] ?? AGGREGATES[lower];
      if (fn || agg) {
        this.next();
        this.expect("(", `「${name}」后面的左括号「(」`);
        if (agg) return this.aggregate(name, agg, token.pos);
        const args = this.arguments();
        if (fn.arity === "2+") {
          if (args.length < 2) throw new FormulaError(`「${name}」至少要两个参数`, token.pos);
          return args.slice(1).reduce((acc, item) => ({ f: fn.fn, a: [acc, item] }), args[0]);
        }
        if (args.length !== fn.arity) {
          throw new FormulaError(`「${name}」要 ${fn.arity} 个参数，这里有 ${args.length} 个`, token.pos);
        }
        return { f: fn.fn, a: args };
      }
      if (CJK.test(name)) throw new FormulaError(`「${name}」不能放在这里`, token.pos);
      this.next();
      return { v: this.path(name) };
    }
    throw new FormulaError(token.t === "end" ? "公式还没写完" : "这里应该是数字、变量或函数", token.pos);
  }

  private arguments(): Expr[] {
    const args: Expr[] = [];
    if (this.take(")")) return args;
    do args.push(this.expression());
    while (this.take(","));
    this.expect(")", "右括号「)」或逗号");
    return args;
  }

  private aggregate(name: string, agg: AggName, pos: number): Expr {
    const listToken = this.next();
    if (listToken.t !== "name" || CJK.test(listToken.value)) {
      throw new FormulaError(`「${name}」的第一个参数应该是一个列表，例如 history`, listToken.pos);
    }
    const over = this.path(listToken.value);
    this.expect(",", "逗号");
    const lastToken = this.next();
    if (lastToken.t !== "num" || !Number.isInteger(lastToken.value)) {
      throw new FormulaError(`「${name}」的第二个参数是最近几项（整数，0 表示全部）`, lastToken.pos);
    }
    const node: Extract<Expr, { agg: AggName }> = { agg, over, last: lastToken.value };
    if (aggTakesValue(agg)) {
      this.expect(",", `逗号（「${name}」第三个参数是要统计的值）`);
      node.value = this.expression();
      if (this.take(",")) node.where = this.expression();
    } else if (this.take(",")) {
      node.where = this.expression();
    } else if (agg === "any") {
      throw new FormulaError("「存在」要写条件，例如 存在(seats, 0, it.winStreak >= 3)", pos);
    }
    this.expect(")", "右括号「)」");
    return node;
  }
}

/** Parse one formula into an expression tree. Throws FormulaError with a Chinese message. */
export function parseFormula(source: string): Expr {
  const parser = new Parser(tokenize(source));
  const expr = parser.expression();
  if (!parser.atEnd()) throw new FormulaError("这里多出了内容", parser.peek().pos);
  return expr;
}

const INFIX: Partial<Record<FnName, { symbol: string; prec: number }>> = {
  or: { symbol: " 或 ", prec: 1 },
  and: { symbol: " 且 ", prec: 2 },
  gt: { symbol: " > ", prec: 4 },
  ge: { symbol: " >= ", prec: 4 },
  lt: { symbol: " < ", prec: 4 },
  le: { symbol: " <= ", prec: 4 },
  eq: { symbol: " == ", prec: 4 },
  ne: { symbol: " != ", prec: 4 },
  add: { symbol: " + ", prec: 5 },
  sub: { symbol: " - ", prec: 5 },
  mul: { symbol: " * ", prec: 6 },
  div: { symbol: " / ", prec: 6 },
};

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

/** Print an expression tree as a formula (Chinese function names). parse(print(e)) gives e back. */
export function printFormula(expr: Expr, parentPrec = 0): string {
  if ("n" in expr) {
    const text = formatNumber(expr.n);
    return expr.n < 0 && parentPrec > 5 ? `(${text})` : text;
  }
  if ("s" in expr) return JSON.stringify(expr.s);
  if ("b" in expr) return expr.b ? "真" : "假";
  if ("v" in expr) return expr.v;
  if ("agg" in expr) {
    const parts = [expr.over, String(expr.last)];
    if (expr.value) parts.push(printFormula(expr.value));
    if (expr.where) parts.push(printFormula(expr.where));
    return `${AGG_PRINT[expr.agg]}(${parts.join(", ")})`;
  }
  const infix = INFIX[expr.f];
  if (infix) {
    const comparison = infix.prec === 4;
    const left = printFormula(expr.a[0], comparison ? 5 : infix.prec);
    const right = printFormula(expr.a[1], infix.prec + 1);
    const text = `${left}${infix.symbol}${right}`;
    return infix.prec < parentPrec || (comparison && parentPrec === 4) ? `(${text})` : text;
  }
  if (expr.f === "not") {
    const text = `非 ${printFormula(expr.a[0], 3)}`;
    return parentPrec > 3 ? `(${text})` : text;
  }
  if (expr.f === "neg") {
    const text = `-${printFormula(expr.a[0], 7)}`;
    return parentPrec > 5 ? `(${text})` : text;
  }
  return `${FN_PRINT[expr.f] ?? expr.f}(${expr.a.map((item) => printFormula(item)).join(", ")})`;
}

// ---------- Whole-strategy text ----------

export interface BetFieldName {
  key: string;
  label: string;
}

/**
 * The whole strategy as text, one rule per line:
 *   当 me.lossStreak >= 3 时：前注 = 50，后注 = 100
 *   否则：前注 = 10，后注 = 20
 */
export function printStrategyText(strategy: RuleStrategy, fields: BetFieldName[]): string {
  const bet = (value: RuleBet) =>
    fields.map((field) => `${field.label} = ${value[field.key] ? printFormula(value[field.key]) : "0"}`).join("，");
  const lines = strategy.rules.map((rule) => `当 ${printFormula(rule.when)} 时：${bet(rule.bet)}`);
  lines.push(`否则：${bet(strategy.otherwise)}`);
  return lines.join("\n");
}

export class StrategyTextError extends FormulaError {
  readonly line: number;
  constructor(message: string, line: number, position: number) {
    super(`第 ${line} 行：${message}`, position);
    this.line = line;
  }
}

/** Parse the whole-strategy text back into rules. Name and description are kept from `base`. */
export function parseStrategyText(
  source: string,
  fields: BetFieldName[],
  base: Pick<RuleStrategy, "gameId" | "name" | "description">,
): RuleStrategy {
  const rules: Rule[] = [];
  let otherwise: RuleBet | null = null;
  const labels = fields.map((field) => field.label);
  source.split(/\r?\n/).forEach((raw, lineIndex) => {
    const line = raw.trim();
    const lineNo = lineIndex + 1;
    if (!line || line.startsWith("#") || line.startsWith("//")) return;
    try {
      const parser = new Parser(tokenize(line, labels));
      if (otherwise) throw new FormulaError("「否则」必须是最后一行", 0);
      let when: Expr | null = null;
      if (parser.take("当")) {
        when = parser.expression();
        parser.expect("时", "「时」");
      } else if (!parser.take("否则")) {
        throw new FormulaError("每行要以「当 … 时」或「否则」开头", 0);
      }
      parser.take(":");
      const bet: RuleBet = {};
      do {
        const token = parser.next();
        const field =
          token.t === "name" ? fields.find((item) => item.label === token.value || item.key === token.value) : undefined;
        if (!field) throw new FormulaError(`这里应该是 ${labels.join(" 或 ")}`, token.pos);
        if (bet[field.key]) throw new FormulaError(`${field.label}写了两次`, token.pos);
        parser.expect("==", "「=」");
        bet[field.key] = parser.expression();
      } while (parser.take(",") || parser.take(";"));
      if (!parser.atEnd()) throw new FormulaError("这里多出了内容", parser.peek().pos);
      for (const field of fields) {
        if (!bet[field.key]) throw new FormulaError(`缺少${field.label}`, line.length);
      }
      if (when) rules.push({ when, bet });
      else otherwise = bet;
    } catch (error) {
      if (error instanceof FormulaError) throw new StrategyTextError(error.message, lineNo, error.position);
      throw error;
    }
  });
  if (!otherwise) throw new StrategyTextError("最后要有一行「否则：…」", source.split(/\r?\n/).length, 0);
  return { version: 1, ...base, rules, otherwise };
}
