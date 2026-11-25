import type { ParamField } from "../actions.ts";
import type { StrategyInput, StrategyModule } from "../game-module.ts";
import { CUSTOM_STRATEGY_PREFIX, getGame, registerStrategy } from "../registry.ts";
import { RuleBudgetError, evaluate, truthy } from "./evaluate.ts";
import type { RuleBet, RuleStrategy, Value } from "./types.ts";
import { assertRuleStrategy } from "./validate.ts";

/** What a rule strategy decided for one bet, and why: shown in the editor's preview. */
export interface RuleDecision {
  action: unknown;
  /** Index of the rule that decided the bet; -1 = 否则. */
  ruleIndex: number;
  /** The final number for each bet field. */
  values: Record<string, number>;
  /** What the formulas produced before limits were applied (null = no number). */
  raw: Record<string, Value>;
  /** Everything that had to be adjusted, in plain Chinese. Empty when the formulas fit as is. */
  issues: string[];
}

/** Round down to the field's step, then keep within [min, max] (the same as the presets do). */
function fitToField(value: number, field: ParamField): number {
  const step = field.step > 0 ? field.step : 1;
  const stepped = Math.floor(value / step) * step;
  return Math.max(field.min, Math.min(field.max, stepped));
}

function formatRaw(value: Value) {
  return typeof value === "number" ? String(Number(value.toFixed(2))) : String(value);
}

/** Decide one bet. Pure: same strategy + same input → same decision. */
export function decideRuleBet(strategy: RuleStrategy, input: StrategyInput): RuleDecision {
  const game = getGame(strategy.gameId);
  const fields = input.spec.kind === "params" ? input.spec.fields : (game.paramFields?.() ?? []);
  const issues: string[] = [];
  const budget = { steps: 0 };
  let ruleIndex = -1;
  let bet: RuleBet = strategy.otherwise;
  const raw: Record<string, Value> = {};
  let overBudget = false;

  try {
    for (let index = 0; index < strategy.rules.length; index += 1) {
      if (truthy(evaluate(strategy.rules[index].when, input, budget))) {
        ruleIndex = index;
        bet = strategy.rules[index].bet;
        break;
      }
    }
    for (const field of fields) raw[field.key] = bet[field.key] ? evaluate(bet[field.key], input, budget) : null;
  } catch (error) {
    if (!(error instanceof RuleBudgetError)) throw error;
    issues.push(`${error.message}，这一局按默认注下`);
    overBudget = true;
    for (const field of fields) raw[field.key] = null;
  }

  const values: Record<string, number> = {};
  for (const field of fields) {
    const value = raw[field.key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      values[field.key] = field.defaultValue;
      if (!overBudget) issues.push(`${field.label}没算出数字（${formatRaw(value)}），按默认 ${field.defaultValue} 下`);
      continue;
    }
    const fitted = fitToField(value, field);
    values[field.key] = fitted;
    if (fitted !== value) {
      const reason =
        value > field.max
          ? `超过上限 ${field.max}`
          : value < field.min
            ? `低于下限 ${field.min}`
            : `注额以 ${field.step} 为单位`;
      issues.push(`${field.label}算出 ${formatRaw(value)}，${reason}，按 ${fitted} 下`);
    }
  }

  let action = game.paramsToAction!(values);
  const problem = input.check?.(action);
  if (problem) {
    const fallback = Object.fromEntries(fields.map((field) => [field.key, field.defaultValue]));
    const text = fields.map((field) => `${field.label} ${values[field.key]}`).join("、");
    issues.push(`算出的注（${text}）桌上不收（${problem}），改下默认注`);
    Object.assign(values, fallback);
    action = game.paramsToAction!(values);
  }
  return { action, ruleIndex, values, raw, issues };
}

export interface RuleStrategyModule extends StrategyModule {
  readonly strategy: RuleStrategy;
  explain(input: StrategyInput): RuleDecision;
}

/** A short, stable id for a strategy's content, so the same rules always get the same id. */
export function ruleStrategyHash(strategy: RuleStrategy): string {
  const text = JSON.stringify(strategy);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Validate and turn a rule strategy into a StrategyModule. Throws with the reasons if invalid. */
export function compileRuleStrategy(input: unknown, id?: string): RuleStrategyModule {
  const strategy = assertRuleStrategy(input);
  const ruleCount = strategy.rules.length;
  return {
    id: id ?? `${CUSTOM_STRATEGY_PREFIX}${ruleStrategyHash(strategy)}`,
    name: strategy.name,
    short: ruleCount ? `自定义 · ${ruleCount} 条规则` : "自定义",
    description: strategy.description ?? "",
    strategy,
    act: (strategyInput) => decideRuleBet(strategy, strategyInput).action,
    explain: (strategyInput) => decideRuleBet(strategy, strategyInput),
  };
}

/** Compile and register under `id` (replacing an older version with the same id). */
export function registerRuleStrategy(input: unknown, id: string): RuleStrategyModule {
  if (!id.startsWith(CUSTOM_STRATEGY_PREFIX)) throw new Error(`Custom strategy ids start with ${CUSTOM_STRATEGY_PREFIX}`);
  const compiled = compileRuleStrategy(input, id);
  registerStrategy(compiled.strategy.gameId, compiled);
  return compiled;
}
