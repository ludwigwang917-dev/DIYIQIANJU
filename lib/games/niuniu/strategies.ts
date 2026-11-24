import type { ActionSpec, ParamField } from "../../core/actions.ts";
import type { StrategyInput, StrategyModule } from "../../core/game-module.ts";

interface BettingContext {
  bankroll: number;
  lossStreak: number;
  lastOutcome: "win" | "loss" | "none";
}

interface Bet {
  front: number;
  back: number;
}

function fieldOf(spec: ActionSpec, key: string): ParamField | undefined {
  if (spec.kind !== "params") return undefined;
  return spec.fields.find((field) => field.key === key);
}

/** Round down to the field's step (10 points at this table), then clamp into [min, max]. */
function clampToSpec(value: number, field: ParamField | undefined): number {
  if (!field) return Math.floor(value);
  const step = field.step > 0 ? field.step : 1;
  const stepped = Math.floor(value / step) * step;
  return Math.max(field.min, Math.min(field.max, stepped));
}

function toPlaceBet(bet: Bet, spec: ActionSpec) {
  const frontField = fieldOf(spec, "front");
  const backField = fieldOf(spec, "back");
  return {
    kind: "place_bet" as const,
    front: clampToSpec(bet.front, frontField),
    back: clampToSpec(bet.back, backField),
  };
}

type BetFn = (context: BettingContext) => Bet;

function defineStrategy(
  id: string,
  name: string,
  short: string,
  description: string,
  bet: BetFn,
): StrategyModule {
  return {
    id,
    name,
    short,
    description,
    act(input: StrategyInput) {
      const requested = bet({
        bankroll: input.me.bankroll,
        lossStreak: input.me.lossStreak,
        lastOutcome: input.me.lastOutcome,
      });
      return toPlaceBet(requested, input.spec);
    },
  };
}

export const niuniuStrategies: StrategyModule[] = [
  defineStrategy("flat", "平注", "固定下注", "每局固定前注 10、后注 20，不追涨杀跌。", () => ({
    front: 10,
    back: 20,
  })),
  defineStrategy(
    "martingale",
    "马丁格尔",
    "输后翻倍",
    "基础注前注 10、后注 10，每次亏损后翻倍；资金与上限会迅速约束它。",
    ({ lossStreak }) => {
      const scale = 2 ** Math.min(lossStreak, 4);
      return { front: 10 * scale, back: 10 * scale };
    },
  ),
  defineStrategy(
    "dalembert",
    "达朗贝尔",
    "线性加注",
    "每输一局前注、后注各加 10，赢后回到基础注 10 / 10。",
    ({ lossStreak }) => ({ front: 10 + lossStreak * 10, back: 10 + lossStreak * 10 }),
  ),
  defineStrategy(
    "kelly",
    "凯利",
    "按本金比例",
    "用当前本金的一小部分下注；负期望下比例管理不能创造优势。",
    ({ bankroll }) => ({ front: Math.max(10, bankroll * 0.015), back: bankroll * 0.03 }),
  ),
  defineStrategy("conservative", "保守", "低波动", "只下最小注：前注 10、不下后注，用更长时间换取同一个长期方向。", () => ({
    front: 10,
    back: 0,
  })),
  defineStrategy("aggressive", "激进", "高波动", "前注 30、后注 50，放大短期输赢与破产速度。", () => ({
    front: 30,
    back: 50,
  })),
  defineStrategy("highroller", "豪客", "顶格下注", "使用规则上限：前注 50、后注 100。", () => ({
    front: 50,
    back: 100,
  })),
  defineStrategy("front", "偏前", "押牌型倍率", "把风险集中在会吃牌型倍率的前注：前注 30、后注 10。", () => ({
    front: 30,
    back: 10,
  })),
  defineStrategy("back", "偏后", "押固定倍率", "主要使用永远一倍结算的后注：前注 10、后注 60。", () => ({
    front: 10,
    back: 60,
  })),
  defineStrategy(
    "adaptive",
    "灵活观察",
    "依据上一局",
    "赢后加注到 20 / 40、输后收缩到 10 / 10；只改变路径，不改变概率。",
    ({ lastOutcome }) =>
      lastOutcome === "win" ? { front: 20, back: 40 } : { front: 10, back: 10 },
  ),
];
