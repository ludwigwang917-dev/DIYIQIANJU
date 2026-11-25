import type { Observation } from "../game-module.ts";
import { RULE_LIMITS, type Expr, type Value } from "./types.ts";

/** Thrown when one decision takes more steps than RULE_LIMITS.steps. */
export class RuleBudgetError extends Error {
  constructor() {
    super("规则太复杂：这一局算到一半超出了步数上限");
  }
}

interface Context {
  root: Observation;
  /** The current list item (`it`), innermost statistic only. */
  item: unknown;
  steps: number;
}

function read(target: unknown, parts: string[]): Value {
  let current: unknown = target;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === "number") return Number.isFinite(current) ? current : null;
  if (typeof current === "string" || typeof current === "boolean") return current;
  return null;
}

function readList(ctx: Context, over: string): unknown[] {
  let current: unknown = over.startsWith("it.") ? ctx.item : ctx.root;
  for (const part of (over.startsWith("it.") ? over.slice(3) : over).split(".")) {
    if (current == null || typeof current !== "object") return [];
    current = (current as Record<string, unknown>)[part];
  }
  return Array.isArray(current) ? current.filter((item) => item != null) : [];
}

/** The most recent `last` items. `history` is oldest-first, `departures` newest-first. */
function recent(over: string, items: unknown[], last: number) {
  if (last <= 0 || last >= items.length) return items;
  return over === "departures" ? items.slice(0, last) : items.slice(-last);
}

export function truthy(value: Value): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value !== "";
  return false;
}

function num(value: Value): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arithmetic(a: Value, b: Value, op: (x: number, y: number) => number): Value {
  const x = num(a);
  const y = num(b);
  if (x == null || y == null) return null;
  const result = op(x, y);
  return Number.isFinite(result) ? result : null;
}

function step(ctx: Context) {
  ctx.steps += 1;
  if (ctx.steps > RULE_LIMITS.steps) throw new RuleBudgetError();
}

function evaluateIn(expr: Expr, ctx: Context): Value {
  step(ctx);
  if ("n" in expr) return expr.n;
  if ("s" in expr) return expr.s;
  if ("b" in expr) return expr.b;
  if ("v" in expr) {
    return expr.v.startsWith("it.") ? read(ctx.item, expr.v.slice(3).split(".")) : read(ctx.root, expr.v.split("."));
  }
  if ("agg" in expr) {
    const items = recent(expr.over, readList(ctx, expr.over), expr.last);
    const outer = ctx.item;
    const values: number[] = [];
    let count = 0;
    try {
      for (const item of items) {
        step(ctx);
        ctx.item = item;
        if (expr.where && !truthy(evaluateIn(expr.where, ctx))) continue;
        if (expr.agg === "any") return true;
        count += 1;
        if (expr.value) {
          const value = num(evaluateIn(expr.value, ctx));
          if (value != null) values.push(value);
        }
      }
    } finally {
      ctx.item = outer;
    }
    switch (expr.agg) {
      case "any":
        return false;
      case "count":
        return count;
      case "sum":
        return values.reduce((sum, value) => sum + value, 0);
      case "avg":
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      case "max":
        return values.length ? Math.max(...values) : null;
      case "min":
        return values.length ? Math.min(...values) : null;
    }
  }
  const [a, b, c] = expr.a;
  switch (expr.f) {
    case "and":
      return truthy(evaluateIn(a, ctx)) && truthy(evaluateIn(b, ctx));
    case "or":
      return truthy(evaluateIn(a, ctx)) || truthy(evaluateIn(b, ctx));
    case "not":
      return !truthy(evaluateIn(a, ctx));
    case "if":
      return truthy(evaluateIn(a, ctx)) ? evaluateIn(b, ctx) : evaluateIn(c, ctx);
    case "isnull":
      return evaluateIn(a, ctx) == null;
    default:
      break;
  }
  const x = evaluateIn(a, ctx);
  if (expr.f === "neg") return arithmetic(0, x, (p, q) => p - q);
  if (expr.f === "abs") return num(x) == null ? null : Math.abs(x as number);
  if (expr.f === "floor") return num(x) == null ? null : Math.floor(x as number);
  const y = evaluateIn(b, ctx);
  switch (expr.f) {
    case "add":
      return arithmetic(x, y, (p, q) => p + q);
    case "sub":
      return arithmetic(x, y, (p, q) => p - q);
    case "mul":
      return arithmetic(x, y, (p, q) => p * q);
    case "div":
      return num(y) === 0 ? null : arithmetic(x, y, (p, q) => p / q);
    case "pow":
      return arithmetic(x, y, (p, q) => p ** q);
    // A missing value (no last bet yet, an empty statistic) is skipped, so 最大(10, …) still gives 10.
    case "min":
      return num(x) == null ? num(y) : num(y) == null ? x : Math.min(x as number, y as number);
    case "max":
      return num(x) == null ? num(y) : num(y) == null ? x : Math.max(x as number, y as number);
    case "gt":
      return num(x) != null && num(y) != null && (x as number) > (y as number);
    case "ge":
      return num(x) != null && num(y) != null && (x as number) >= (y as number);
    case "lt":
      return num(x) != null && num(y) != null && (x as number) < (y as number);
    case "le":
      return num(x) != null && num(y) != null && (x as number) <= (y as number);
    case "eq":
      return x === y;
    case "ne":
      return x !== y;
    default:
      return null;
  }
}

/** Evaluate one expression against an observation. Shares one step budget per decision. */
export function evaluate(expr: Expr, root: Observation, budget: { steps: number } = { steps: 0 }): Value {
  const ctx: Context = { root, item: null, steps: budget.steps };
  try {
    return evaluateIn(expr, ctx);
  } finally {
    budget.steps = ctx.steps;
  }
}
