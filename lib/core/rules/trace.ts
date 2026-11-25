import type { Observation } from "../game-module.ts";
import { evaluate, truthy } from "./evaluate.ts";
import type { Expr, FnName, RuleStrategy, Value } from "./types.ts";

const COMPARISONS = new Set<FnName>(["gt", "ge", "lt", "le", "eq", "ne"]);

/** One condition of a rule, with the values it saw: "我的连输 3 ≥ 3 ✓". */
export interface ConditionCheck {
  /** For a comparison: both sides and the operator. Otherwise only `expr`. */
  expr: Expr;
  op?: FnName;
  left?: Expr;
  right?: Expr;
  leftValue?: Value;
  rightValue?: Value;
  ok: boolean;
}

export interface RuleTrace {
  ruleIndex: number;
  /** "and" = all must hold, "or" = any. */
  joiner: "and" | "or";
  checks: ConditionCheck[];
  matched: boolean;
}

function chain(expr: Expr, fn: "and" | "or"): Expr[] {
  return "f" in expr && expr.f === fn ? [...chain(expr.a[0], fn), ...chain(expr.a[1], fn)] : [expr];
}

/**
 * Why the strategy bet what it bet: each rule checked from the top until one matched, with the
 * value of every condition. Read-only and deterministic, for showing on the table; the bet
 * itself comes from decideRuleBet.
 */
export function traceRuleDecision(strategy: RuleStrategy, input: Observation): RuleTrace[] {
  const traces: RuleTrace[] = [];
  const budget = { steps: 0 };
  try {
    for (let ruleIndex = 0; ruleIndex < strategy.rules.length; ruleIndex += 1) {
      const when = strategy.rules[ruleIndex].when;
      const joiner = "f" in when && when.f === "or" ? "or" : "and";
      const items = "f" in when && (when.f === "and" || when.f === "or") ? chain(when, when.f) : [when];
      const checks = items.map((item): ConditionCheck => {
        if ("f" in item && COMPARISONS.has(item.f)) {
          const leftValue = evaluate(item.a[0], input, budget);
          const rightValue = evaluate(item.a[1], input, budget);
          return { expr: item, op: item.f, left: item.a[0], right: item.a[1], leftValue, rightValue, ok: truthy(evaluate(item, input, budget)) };
        }
        return { expr: item, ok: truthy(evaluate(item, input, budget)) };
      });
      const matched = truthy(evaluate(when, input, budget));
      traces.push({ ruleIndex, joiner, checks, matched });
      if (matched) break;
    }
  } catch {
    // Over the step budget: decideRuleBet already reports it; show what was traced so far.
  }
  return traces;
}
