/**
 * A rule strategy: what a person builds in the strategy editor (积木 + 公式).
 * Stored as plain JSON so it can be saved locally, shared by link and replayed exactly.
 * Executed by our own interpreter (evaluate.ts): no eval, no user JavaScript.
 * Design: docs/strategy-editor-design.md.
 */

/** An expression. Every node is a small JSON object; see FN_ARITY / AGG_NAMES for the vocabulary. */
export type Expr =
  | { n: number }
  | { s: string }
  | { b: boolean }
  /** A variable: an Observation path (`me.lossStreak`), or `it.<field>` inside a list statistic. */
  | { v: string }
  | { f: FnName; a: Expr[] }
  /**
   * A statistic over a list (`history`, `seats`, `departures`, or a list inside the current item
   * such as `it.detail.seats`). `last` = how many of the most recent items (0 = all).
   * Inside `where` / `value`, `it` is the current item.
   */
  | { agg: AggName; over: string; last: number; where?: Expr; value?: Expr };

export type FnName =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "neg"
  | "min"
  | "max"
  | "pow"
  | "abs"
  | "floor"
  | "gt"
  | "ge"
  | "lt"
  | "le"
  | "eq"
  | "ne"
  | "and"
  | "or"
  | "not"
  | "if"
  | "isnull";

export type AggName = "count" | "sum" | "avg" | "max" | "min" | "any";

/** Number of arguments each function takes. */
export const FN_ARITY: Record<FnName, number> = {
  add: 2,
  sub: 2,
  mul: 2,
  div: 2,
  neg: 1,
  min: 2,
  max: 2,
  pow: 2,
  abs: 1,
  floor: 1,
  gt: 2,
  ge: 2,
  lt: 2,
  le: 2,
  eq: 2,
  ne: 2,
  and: 2,
  or: 2,
  not: 1,
  if: 3,
  isnull: 1,
};

export const AGG_NAMES: AggName[] = ["count", "sum", "avg", "max", "min", "any"];

/** One value per bet field of the game (for niuniu: `front`, `back`). */
export type RuleBet = Record<string, Expr>;

export interface Rule {
  when: Expr;
  bet: RuleBet;
}

export interface RuleStrategy {
  version: 1;
  gameId: string;
  name: string;
  description?: string;
  /** Checked top to bottom; the first rule whose `when` holds decides the bet. */
  rules: Rule[];
  /** The bet when no rule holds. */
  otherwise: RuleBet;
}

/** Values an expression can produce. */
export type Value = number | string | boolean | null;

/** Size limits that keep a strategy small enough to read and fast enough to run a million times. */
export const RULE_LIMITS = {
  rules: 20,
  /** Expression nodes in the whole strategy. */
  nodes: 600,
  depth: 24,
  nameLength: 40,
  descriptionLength: 300,
  stringLength: 40,
  /** Evaluation steps for one decision (each node and each list item counts one). */
  steps: 20_000,
  /** Largest `last` a statistic may ask for. */
  last: 1000,
} as const;
