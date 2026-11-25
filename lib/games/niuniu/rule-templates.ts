import { parseFormula, parseStrategyText } from "../../core/rules/formula.ts";
import type { Expr, RuleStrategy } from "../../core/rules/types.ts";

/** 斗牛的注额字段（与 module.ts 的 BET_SPEC 一致），用于解析整段策略文字。 */
export const NIUNIU_BET_NAMES = [
  { key: "front", label: "前注" },
  { key: "back", label: "后注" },
];

function strategy(name: string, description: string, text: string): RuleStrategy {
  return parseStrategyText(text, NIUNIU_BET_NAMES, { gameId: "niuniu", name, description });
}

/**
 * The 10 presets written as rules. The contract test plays each against its hand-written
 * version with the same seed and expects identical tables: proof the editor can express them.
 */
export const PRESETS_AS_RULES: Record<string, RuleStrategy> = {
  flat: strategy("平注", "每局固定前注 10、后注 20。", "否则：前注 = 10，后注 = 20"),
  martingale: strategy(
    "马丁格尔",
    "输一局翻一倍，最多翻 4 次。",
    "否则：前注 = 10 * 幂(2, 最小(me.lossStreak, 4))，后注 = 10 * 幂(2, 最小(me.lossStreak, 4))",
  ),
  dalembert: strategy(
    "达朗贝尔",
    "每输一局前后注各加 10，赢了回到 10。",
    "否则：前注 = 10 + me.lossStreak * 10，后注 = 10 + me.lossStreak * 10",
  ),
  kelly: strategy(
    "凯利",
    "按当前本金的比例下注。",
    "否则：前注 = 最大(10, me.bankroll * 0.015)，后注 = me.bankroll * 0.03",
  ),
  conservative: strategy("保守", "只下最小注。", "否则：前注 = 10，后注 = 0"),
  aggressive: strategy("激进", "前注 30、后注 50。", "否则：前注 = 30，后注 = 50"),
  highroller: strategy("豪客", "顶格下注。", "否则：前注 = 50，后注 = 100"),
  front: strategy("偏前", "前注 30、后注 10。", "否则：前注 = 30，后注 = 10"),
  back: strategy("偏后", "前注 10、后注 60。", "否则：前注 = 10，后注 = 60"),
  adaptive: strategy(
    "灵活观察",
    "赢了加到 20 / 40，输了收回 10 / 10。",
    ['当 me.lastOutcome == "win" 时：前注 = 20，后注 = 40', "否则：前注 = 10，后注 = 10"].join("\n"),
  ),
};

export interface StrategyTemplate {
  id: string;
  /** The belief behind it, in the gambler's own words. */
  belief: string;
  strategy: RuleStrategy;
}

/**
 * “迷信策略”模板：赌桌上常见的说法，原样写成规则。每局都重新洗牌，公开记录里没有任何
 * 东西能预测下一手，所以跑够局数，它们每投注 1 点的输赢都会回到理论值。
 */
export const SUPERSTITION_TEMPLATES: StrategyTemplate[] = [
  {
    id: "dealer-streak",
    belief: "庄家连赢三把了，该轮到我们了",
    strategy: strategy(
      "庄家连赢就反打",
      "庄家对全桌连赢 3 局以上时下大注，平时下小注。",
      ['当 dealer.streak.outcome == "win" 且 dealer.streak.length >= 3 时：前注 = 50，后注 = 100', "否则：前注 = 10，后注 = 10"].join("\n"),
    ),
  },
  {
    id: "hot-hand",
    belief: "跟着手气旺的人下",
    strategy: strategy(
      "追热手",
      "桌上有人连赢 3 局以上，就跟着下大。",
      ["当 存在(seats, 0, 非 it.isMe 且 it.winStreak >= 3) 时：前注 = 30，后注 = 60", "否则：前注 = 10，后注 = 10"].join("\n"),
    ),
  },
  {
    id: "road",
    belief: "看路单：闲路旺就一直押下去",
    strategy: strategy(
      "看路单",
      "最近 10 局里闲家赢了 6 局以上，就下大注。",
      ["当 计数(history, 10, it.dealerDelta < 0) >= 6 时：前注 = 50，后注 = 100", "否则：前注 = 10，后注 = 20"].join("\n"),
    ),
  },
  {
    id: "new-dealer",
    belief: "新荷官手生，刚换班那几局好赢",
    strategy: strategy(
      "新荷官手生",
      "荷官刚换班的前 5 局下大注。",
      ["当 dealer.roundsThisShift < 5 时：前注 = 40，后注 = 80", "否则：前注 = 10，后注 = 10"].join("\n"),
    ),
  },
  {
    id: "jokers-due",
    belief: "大小王憋了好几局，该出来了",
    strategy: strategy(
      "大小王该来了",
      "最近 5 局桌上谁都没拿到大小王，就下大注。",
      [
        '当 计数(history, 5, 存在(it.detail.dealer.cards, 0, it.suit == "joker") 或 存在(it.detail.seats, 0, 存在(it.cards, 0, it.suit == "joker"))) == 0 时：前注 = 50，后注 = 100',
        "否则：前注 = 10，后注 = 10",
      ].join("\n"),
    ),
  },
  {
    id: "follow-big",
    belief: "跟着下大注的人走",
    strategy: strategy(
      "跟大注",
      "前面有人下了大前注，就跟着下一样的前注。",
      ["否则：前注 = 最大(10, 最大值(seats, 0, it.betThisRound.front))，后注 = 10"].join("\n"),
    ),
  },
  {
    id: "chase",
    belief: "这趟输多了，加大注才追得回来",
    strategy: strategy(
      "输多了加码",
      "这趟输超过 300 就下顶格注，想一把追回来。",
      ["当 me.visitNet < -300 时：前注 = 50，后注 = 100", "否则：前注 = 10，后注 = 20"].join("\n"),
    ),
  },
];

/** A blank strategy to start from. */
export function blankStrategy(name = "我的策略"): RuleStrategy {
  return strategy(name, "", ["当 me.lossStreak >= 3 时：前注 = 30，后注 = 30", "否则：前注 = 10，后注 = 20"].join("\n"));
}

export interface StatSnippet {
  label: string;
  expr: Expr;
}

/** Ready-made statistics for the variable picker (the “统计” group). */
export const STAT_SNIPPETS: StatSnippet[] = [
  { label: "最近 10 局庄家赢了几局", expr: parseFormula("计数(history, 10, it.dealerDelta > 0)") },
  { label: "最近 10 局闲家赢了几局", expr: parseFormula("计数(history, 10, it.dealerDelta < 0)") },
  { label: "最近 10 局庄家开出牛牛几次", expr: parseFormula("计数(history, 10, it.detail.dealer.cattle == 10)") },
  { label: "最近 10 局我的输赢合计", expr: parseFormula("求和(history, 10, 求和(it.seats, 0, it.delta, it.seatIndex == me.seatIndex))") },
  { label: "最近 10 局庄家平均牛值", expr: parseFormula("平均(history, 10, it.detail.dealer.cattle)") },
  { label: "本局别人下的最大前注", expr: parseFormula("最大值(seats, 0, it.betThisRound.front, 非 it.isMe)") },
  { label: "桌上别人最长的连赢", expr: parseFormula("最大值(seats, 0, it.winStreak, 非 it.isMe)") },
  { label: "桌上还有几个人", expr: parseFormula("计数(seats, 0)") },
  { label: "最近 20 次离场里输光的人数", expr: parseFormula('计数(departures, 20, it.reason == "bankrupt")') },
];
