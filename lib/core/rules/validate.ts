import type { ObservationField } from "../game-module.ts";
import { getGame } from "../registry.ts";
import { observationCatalog } from "../observe.ts";
import { AGG_NAMES, FN_ARITY, RULE_LIMITS, type AggName, type Expr, type FnName, type RuleStrategy } from "./types.ts";
import { aggTakesValue } from "./formula.ts";

/** One problem found in a strategy, with a Chinese description of where it is. */
export interface RuleIssue {
  where: string;
  message: string;
}

interface Scope {
  /** Catalog path of the list the current `it` comes from, e.g. "history[]". Null at the top. */
  list: string | null;
}

const LIST_LABEL: Record<string, string> = {
  history: "往局记录",
  seats: "各座位",
  departures: "离场记录",
};

/** Look up the catalog field for a variable, or explain why it is not one. */
function fieldFor(catalog: Map<string, ObservationField>, path: string, scope: Scope): ObservationField | string {
  if (path.startsWith("it.")) {
    if (!scope.list) return `「${path}」只能写在列表统计里面（it 是列表里的当前一项）`;
    const full = `${scope.list}.${path.slice(3)}`;
    return catalog.get(full) ?? `「${path}」不是${scope.list}里的字段`;
  }
  if (path.includes("[]")) return `「${path}」不能直接用，请用计数/求和等统计`;
  return catalog.get(path) ?? `没有这个变量：「${path}」`;
}

/** Catalog path of a list used in a statistic ("history" → "history[]"), or why it is not a list. */
function listFor(catalog: Map<string, ObservationField>, over: string, scope: Scope): string | { error: string } {
  let full: string;
  if (over.startsWith("it.")) {
    if (!scope.list) return { error: `「${over}」只能写在另一个列表统计里面` };
    full = `${scope.list}.${over.slice(3)}[]`;
  } else {
    full = `${over}[]`;
  }
  for (const key of catalog.keys()) if (key.startsWith(`${full}.`)) return full;
  return { error: `「${over}」不是能统计的列表（可以用 history、seats、departures）` };
}

export function validateRuleStrategy(input: unknown, gameId?: string): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const add = (where: string, message: string) => issues.push({ where, message });
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [{ where: "策略", message: "不是一份策略" }];
  }
  const strategy = input as Record<string, unknown>;
  const allowedKeys = new Set(["version", "gameId", "name", "description", "rules", "otherwise"]);
  for (const key of Object.keys(strategy)) if (!allowedKeys.has(key)) add("策略", `多了不认识的字段「${key}」`);
  if (strategy.version !== 1) add("策略", "版本号不对（应为 1）");
  if (typeof strategy.gameId !== "string") return [...issues, { where: "策略", message: "缺少游戏类型" }];
  if (gameId && strategy.gameId !== gameId) add("策略", `这是给「${strategy.gameId}」的策略，不能用在这张桌`);
  let game;
  try {
    game = getGame(strategy.gameId);
  } catch {
    return [...issues, { where: "策略", message: `不认识的游戏「${strategy.gameId}」` }];
  }
  const fields = game.paramFields?.() ?? [];
  if (!fields.length || !game.paramsToAction) {
    return [...issues, { where: "策略", message: `${game.meta.name}还不支持自定义策略` }];
  }
  if (typeof strategy.name !== "string" || !strategy.name.trim()) add("名字", "要给策略起个名字");
  else if (strategy.name.length > RULE_LIMITS.nameLength) add("名字", `名字最多 ${RULE_LIMITS.nameLength} 个字`);
  if (strategy.description != null && (typeof strategy.description !== "string" || strategy.description.length > RULE_LIMITS.descriptionLength)) {
    add("说明", `说明最多 ${RULE_LIMITS.descriptionLength} 个字`);
  }

  const catalog = new Map(observationCatalog(strategy.gameId).map((field) => [field.path, field]));
  let nodes = 0;

  const checkExpr = (expr: unknown, where: string, scope: Scope, depth: number): void => {
    nodes += 1;
    if (depth > RULE_LIMITS.depth) {
      add(where, `嵌套太深（最多 ${RULE_LIMITS.depth} 层）`);
      return;
    }
    if (!expr || typeof expr !== "object" || Array.isArray(expr)) {
      add(where, "这里缺一个值");
      return;
    }
    const node = expr as Record<string, unknown>;
    const keys = Object.keys(node);
    if ("n" in node) {
      if (keys.length !== 1 || typeof node.n !== "number" || !Number.isFinite(node.n)) add(where, "数字不对");
      return;
    }
    if ("s" in node) {
      if (keys.length !== 1 || typeof node.s !== "string") add(where, "文字不对");
      else if (node.s.length > RULE_LIMITS.stringLength) add(where, `文字最多 ${RULE_LIMITS.stringLength} 个字`);
      return;
    }
    if ("b" in node) {
      if (keys.length !== 1 || typeof node.b !== "boolean") add(where, "真假值不对");
      return;
    }
    if ("v" in node) {
      if (keys.length !== 1 || typeof node.v !== "string") {
        add(where, "变量不对");
        return;
      }
      const field = fieldFor(catalog, node.v, scope);
      if (typeof field === "string") add(where, field);
      return;
    }
    if ("f" in node) {
      const fn = node.f as FnName;
      if (keys.some((key) => key !== "f" && key !== "a") || !(fn in FN_ARITY) || !Array.isArray(node.a)) {
        add(where, `不认识的函数「${String(node.f)}」`);
        return;
      }
      if (node.a.length !== FN_ARITY[fn]) {
        add(where, `函数参数个数不对`);
        return;
      }
      for (const arg of node.a) checkExpr(arg, where, scope, depth + 1);
      if ((fn === "eq" || fn === "ne") && node.a.length === 2) checkEnumLiteral(node.a as Expr[], where, scope);
      return;
    }
    if ("agg" in node) {
      const agg = node.agg as AggName;
      const allowed = new Set(["agg", "over", "last", "where", "value"]);
      if (keys.some((key) => !allowed.has(key)) || !AGG_NAMES.includes(agg) || typeof node.over !== "string") {
        add(where, "统计写法不对");
        return;
      }
      if (!Number.isInteger(node.last) || (node.last as number) < 0 || (node.last as number) > RULE_LIMITS.last) {
        add(where, `“最近几项”要是 0–${RULE_LIMITS.last} 的整数（0 表示全部）`);
      }
      const list = listFor(catalog, node.over, scope);
      if (typeof list !== "string") {
        add(where, list.error);
        return;
      }
      const inner: Scope = { list };
      if (aggTakesValue(agg)) {
        if (!node.value) add(where, "统计要写统计哪个值");
        else checkExpr(node.value, where, inner, depth + 1);
      } else if (node.value) {
        add(where, "计数/存在不需要统计值");
      }
      if (agg === "any" && !node.where) add(where, "「存在」要写条件");
      if (node.where) checkExpr(node.where, where, inner, depth + 1);
      return;
    }
    add(where, "看不懂的写法");
  };

  // `me.lastOutcome == "赢"` is a typo the engine would silently treat as never true.
  const checkEnumLiteral = (args: Expr[], where: string, scope: Scope) => {
    const [a, b] = args;
    const pair = "v" in a && "s" in b ? [a, b] : "v" in b && "s" in a ? [b, a] : null;
    if (!pair) return;
    const field = fieldFor(catalog, (pair[0] as { v: string }).v, scope);
    if (typeof field === "string" || field.type !== "enum" || !field.values) return;
    const literal = (pair[1] as { s: string }).s;
    if (!field.values.some((option) => option.value === literal)) {
      const options = field.values.map((option) => `"${option.value}"（${option.label}）`).join("、");
      add(where, `「${field.label}」只会是 ${options}，不会是 "${literal}"`);
    }
  };

  const checkBet = (bet: unknown, where: string) => {
    if (!bet || typeof bet !== "object" || Array.isArray(bet)) {
      add(where, "缺少注额");
      return;
    }
    const value = bet as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      if (!fields.some((field) => field.key === key)) add(where, `多了不认识的注额「${key}」`);
    }
    for (const field of fields) {
      if (!(field.key in value)) add(`${where} · ${field.label}`, `缺少${field.label}`);
      else checkExpr(value[field.key], `${where} · ${field.label}`, { list: null }, 0);
    }
  };

  if (!Array.isArray(strategy.rules)) add("规则", "规则列表不对");
  else {
    if (strategy.rules.length > RULE_LIMITS.rules) add("规则", `最多 ${RULE_LIMITS.rules} 条规则`);
    strategy.rules.slice(0, RULE_LIMITS.rules).forEach((rule, index) => {
      const where = `第 ${index + 1} 条规则`;
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
        add(where, "规则不对");
        return;
      }
      const item = rule as Record<string, unknown>;
      for (const key of Object.keys(item)) if (key !== "when" && key !== "bet") add(where, `多了不认识的字段「${key}」`);
      checkExpr(item.when, `${where} · 条件`, { list: null }, 0);
      checkBet(item.bet, where);
    });
  }
  checkBet(strategy.otherwise, "否则");
  if (nodes > RULE_LIMITS.nodes) add("策略", `太长了：${nodes} 个积木（最多 ${RULE_LIMITS.nodes} 个）`);
  return issues;
}

/** Throw with all issues joined when the strategy is not valid; return it typed otherwise. */
export function assertRuleStrategy(input: unknown, gameId?: string): RuleStrategy {
  const issues = validateRuleStrategy(input, gameId);
  if (issues.length) {
    throw new Error(issues.map((issue) => `${issue.where}：${issue.message}`).join("；"));
  }
  return input as RuleStrategy;
}

export { LIST_LABEL };
