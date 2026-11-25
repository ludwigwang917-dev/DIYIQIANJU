import assert from "node:assert/strict";
import test from "node:test";
import "../lib/games/niuniu/index.ts";
import { fillAutoSeats, playAutoRound, resolveBustedSeats } from "../lib/core/auto-play.ts";
import { runMonteCarlo } from "../lib/core/monte-carlo.ts";
import { observe } from "../lib/core/observe.ts";
import { getGame, getStrategies } from "../lib/core/registry.ts";
import { mulberry32 } from "../lib/core/rng.ts";
import { compileRuleStrategy, decideRuleBet, registerRuleStrategy } from "../lib/core/rules/compile.ts";
import {
  FormulaError,
  parseFormula,
  parseStrategyText,
  printFormula,
  printStrategyText,
} from "../lib/core/rules/formula.ts";
import { previewRuleStrategy } from "../lib/core/rules/preview.ts";
import { decodeShare, encodeShare, shareFromHash } from "../lib/core/rules/share.ts";
import { validateRuleStrategy } from "../lib/core/rules/validate.ts";
import { createTable, dispatch } from "../lib/core/table.ts";
import {
  NIUNIU_BET_NAMES,
  PRESETS_AS_RULES,
  STAT_SNIPPETS,
  SUPERSTITION_TEMPLATES,
  blankStrategy,
} from "../lib/games/niuniu/rule-templates.ts";

const ALL_RULES = [
  ...Object.values(PRESETS_AS_RULES),
  ...SUPERSTITION_TEMPLATES.map((item) => item.strategy),
  blankStrategy(),
];

function bettingTable(seed = 7, rounds = 15) {
  const rng = mulberry32(seed);
  let table = createTable("niuniu", {
    seats: [
      { profile: { id: "r1", name: "规一", bankroll: 3000 }, control: { kind: "auto", strategyId: "flat" } },
      { profile: { id: "r2", name: "规二", bankroll: 3000 }, control: { kind: "auto", strategyId: "martingale" } },
      null,
      null,
      null,
    ],
  });
  for (let round = 0; round < rounds; round += 1) table = playAutoRound(table, "flat", rng);
  return dispatch(table, { type: "table/start_round" }, rng);
}

function inputFor(table, seatIndex) {
  const seen = observe(table, seatIndex);
  const mod = getGame(table.gameId);
  return {
    ...seen,
    spec: seen.spec,
    check: (action) => mod.validate(table.roundCtx.gameState, seatIndex, action, table.seats[seatIndex]),
  };
}

test("formulas parse in Chinese or English and print back to the same tree", () => {
  const sources = [
    "1 + 2 * 3",
    "(1 + 2) * 3",
    "10 - (-5)",
    "-me.visitNet / 2",
    '如果(dealer.streak.length >= 3 且 dealer.streak.outcome == "win", 50, 10)',
    "if(me.lossStreak > 2 and not me.winStreak > 0, 30, 10)",
    "最小(me.lossStreak, 4, 2)",
    "10 * 幂(2, 最小(me.lossStreak, 4))",
    "计数(history, 10, it.dealerDelta > 0)",
    "求和(history, 10, 求和(it.seats, 0, it.delta, it.seatIndex == me.seatIndex))",
    '存在(seats, 0, 非 it.isMe 且 it.winStreak >= 3) 或 me.lastOutcome == "loss"',
    "最大(10, 最大值(seats, 0, it.betThisRound.front))",
    "为空(me.lastBet.front)",
    "me.bankroll * 0.015",
    "a ≥ 3 且 b ≠ 2",
  ];
  for (const source of sources) {
    const tree = parseFormula(source);
    const printed = printFormula(tree);
    assert.deepEqual(parseFormula(printed), tree, `${source} → ${printed}`);
  }
  assert.deepEqual(parseFormula("1 + 2 * 3"), { f: "add", a: [{ n: 1 }, { f: "mul", a: [{ n: 2 }, { n: 3 }] }] });
  assert.deepEqual(parseFormula("me.lossStreak>=3且me.winStreak==0"), parseFormula("me.lossStreak >= 3 且 me.winStreak == 0"));
});

test("bad formulas are refused with a Chinese reason and a position", () => {
  const cases = [
    ["1 +", /还没写完/],
    ["如果(1, 2)", /3 个参数/],
    ["1 < 2 < 3", /不能连着写/],
    ["计数(10, 3)", /列表/],
    ["(1 + 2", /右括号/],
    ["我的本金 > 3", /看不懂/],
    ['me.lastOutcome == "win', /引号/],
  ];
  for (const [source, pattern] of cases) {
    assert.throws(() => parseFormula(source), (error) => error instanceof FormulaError && pattern.test(error.message), source);
  }
});

test("every preset, template and blank strategy is valid and survives the text view round trip", () => {
  for (const strategy of ALL_RULES) {
    assert.deepEqual(validateRuleStrategy(strategy, "niuniu"), [], strategy.name);
    const text = printStrategyText(strategy, NIUNIU_BET_NAMES);
    const back = parseStrategyText(text, NIUNIU_BET_NAMES, strategy);
    assert.deepEqual(back, strategy, strategy.name);
  }
  for (const snippet of STAT_SNIPPETS) {
    const strategy = { ...blankStrategy(), rules: [{ when: { f: "gt", a: [snippet.expr, { n: 0 }] }, bet: { front: { n: 10 }, back: { n: 10 } } }] };
    assert.deepEqual(validateRuleStrategy(strategy, "niuniu"), [], snippet.label);
  }
});

test("the validator refuses unknown variables, misplaced it, typos in enum values and junk", () => {
  const base = blankStrategy();
  const withWhen = (formula) => ({ ...base, rules: [{ when: parseFormula(formula), bet: base.otherwise }] });
  const expectIssue = (strategy, pattern) => {
    const issues = validateRuleStrategy(strategy, "niuniu");
    assert.ok(issues.some((issue) => pattern.test(issue.message)), `${JSON.stringify(issues)} should match ${pattern}`);
  };
  expectIssue(withWhen("me.secretCards > 0"), /没有这个变量/);
  expectIssue(withWhen("it.dealerDelta > 0"), /只能写在列表统计里面/);
  expectIssue({ ...base, rules: [{ when: { v: "history[].dealerDelta" }, bet: base.otherwise }] }, /统计/);
  expectIssue(withWhen('me.lastOutcome == "赢"'), /不会是 "赢"/);
  expectIssue(withWhen("计数(deck, 0)"), /不是能统计的列表/);
  expectIssue(withWhen("计数(history, 10, it.nope > 1)"), /不是history\[\]里的字段/);
  expectIssue({ ...base, rules: [{ when: { f: "eval", a: [] }, bet: base.otherwise }] }, /不认识的函数/);
  expectIssue({ ...base, rules: [{ when: { b: true }, bet: { front: { n: 10 } } }] }, /缺少后注/);
  expectIssue({ ...base, extra: 1 }, /不认识的字段/);
  expectIssue({ ...base, rules: Array(21).fill({ when: { b: true }, bet: base.otherwise }) }, /最多 20 条/);
  expectIssue({ ...base, gameId: "blackjack" }, /不认识的游戏/);
  assert.ok(validateRuleStrategy("not a strategy").length > 0);
});

test("all 10 presets written as rules play exactly like the hand-written presets (same seed, same table)", () => {
  for (const [presetId, rules] of Object.entries(PRESETS_AS_RULES)) {
    const customId = `custom-equiv-${presetId}`;
    registerRuleStrategy(rules, customId);
    const play = (strategyId) => {
      const rng = mulberry32(31337);
      let table = createTable("niuniu", {
        seats: [
          { profile: { id: "e1", name: "等一", bankroll: 1500 }, control: { kind: "auto", strategyId } },
          { profile: { id: "e2", name: "等二", bankroll: 900 }, control: { kind: "auto", strategyId } },
          null,
          null,
          null,
        ],
      });
      for (let round = 0; round < 400 && table.seats.some(Boolean); round += 1) {
        table = playAutoRound(table, strategyId, rng, { rebuy: true });
      }
      return table;
    };
    const preset = play(presetId);
    const custom = play(customId);
    assert.ok(preset.round > 20, `${presetId} should play a while`);
    assert.deepEqual(custom.roadLog, preset.roadLog, presetId);
    assert.equal(custom.round, preset.round, presetId);
    assert.equal(custom.playerNet, preset.playerNet, presetId);
    assert.deepEqual(
      custom.busts.map(({ reason, bankroll, roundsPlayed, buyIns }) => ({ reason, bankroll, roundsPlayed, buyIns })),
      preset.busts.map(({ reason, bankroll, roundsPlayed, buyIns }) => ({ reason, bankroll, roundsPlayed, buyIns })),
      presetId,
    );
  }
});

test("decisions explain which rule fired and every adjustment; illegal or missing bets fall back visibly", () => {
  const table = bettingTable();
  const input = inputFor(table, 0);
  const base = blankStrategy();

  const fired = decideRuleBet(
    { ...base, rules: [{ when: parseFormula("me.roundsPlayed >= 0"), bet: { front: parseFormula("75"), back: parseFormula("15") } }] },
    input,
  );
  assert.equal(fired.ruleIndex, 0);
  assert.deepEqual(fired.values, { front: 50, back: 10 });
  assert.ok(fired.issues.some((text) => /前注算出 75，超过上限 50/.test(text)));
  assert.ok(fired.issues.some((text) => /后注算出 15，注额以 10 为单位/.test(text)));

  const zero = decideRuleBet({ ...base, rules: [], otherwise: { front: { n: 0 }, back: { n: 0 } } }, input);
  assert.deepEqual(zero.values, { front: 10, back: 10 }, "0 / 0 is not a bet: default stake instead");
  assert.ok(zero.issues.some((text) => /桌上不收/.test(text)));
  assert.equal(getGame("niuniu").validate(null, 0, zero.action, null), null);

  const missing = decideRuleBet({ ...base, rules: [], otherwise: { front: parseFormula("me.lastBet.front / 0"), back: { n: 20 } } }, input);
  assert.equal(missing.values.front, 10);
  assert.ok(missing.issues.some((text) => /前注没算出数字/.test(text)));

  // 15 rounds of history, four nested passes: 15^4 ≈ 50,000 steps, over the 20,000 limit.
  const heavy = parseFormula("计数(history, 0, 计数(history, 0, 计数(history, 0, 计数(history, 0, 真) > 0) > 0) > 0)");
  const budget = decideRuleBet({ ...base, rules: [{ when: heavy, bet: { front: { n: 50 }, back: { n: 100 } } }] }, input);
  assert.equal(budget.ruleIndex, -1);
  assert.ok(budget.issues.some((text) => /步数上限/.test(text)));
});

test("templates read the table as designed: dealer streaks, hot hands, chips on the felt", () => {
  const table = bettingTable(11, 40);
  const input = inputFor(table, 1);
  const byId = Object.fromEntries(SUPERSTITION_TEMPLATES.map((item) => [item.id, compileRuleStrategy(item.strategy)]));

  const streak = input.dealer.streak;
  const dealerHot = streak.outcome === "win" && streak.length >= 3;
  assert.equal(byId["dealer-streak"].explain(input).ruleIndex, dealerHot ? 0 : -1);

  const hot = input.seats.some((seat) => seat && !seat.isMe && seat.winStreak >= 3);
  assert.equal(byId["hot-hand"].explain(input).ruleIndex, hot ? 0 : -1);

  const playersWon = table.roadLog.slice(-10).filter((item) => item.dealerDelta < 0).length;
  assert.equal(byId.road.explain(input).ruleIndex, playersWon >= 6 ? 0 : -1);

  // Seat 1 bets after seat 0: "follow the big bet" copies seat 0's front bet on the felt.
  let afterFirst = table;
  afterFirst = dispatch(afterFirst, { type: "game/action", seatIndex: 0, action: { kind: "place_bet", front: 40, back: 10 } }, mulberry32(1));
  assert.equal(byId["follow-big"].explain(inputFor(afterFirst, 1)).values.front, 40);
});

test("rule strategies are deterministic, legal, zero-sum and reproducible in Monte Carlo", () => {
  const rules = SUPERSTITION_TEMPLATES.find((item) => item.id === "jokers-due").strategy;
  const request = { gameId: "niuniu", runs: 60, maxRounds: 200, bankroll: 1000, strategyId: "custom-mc-test", seed: 99, rules };
  const first = runMonteCarlo(request);
  const second = runMonteCarlo(request);
  assert.deepEqual(first, second);
  assert.ok(first.averageWagered > 0);
  assert.ok(Math.abs(first.netPerPointWagered) < 0.5);
  assert.ok(getStrategies("niuniu").some((item) => item.id === "custom-mc-test"));

  const flat = runMonteCarlo({ ...request, strategyId: "flat", rules: undefined });
  assert.ok(Number.isFinite(flat.netPerPointWagered));
  assert.throws(() => runMonteCarlo({ ...request, strategyId: "custom-bad", rules: { version: 1 } }));
});

test("preview plays a short seeded run through the real table and explains each bet", () => {
  const strategy = SUPERSTITION_TEMPLATES.find((item) => item.id === "chase").strategy;
  const rows = previewRuleStrategy(strategy, { seed: 2026 });
  assert.equal(rows.length, 20);
  assert.deepEqual(previewRuleStrategy(strategy, { seed: 2026 }), rows);
  let bankroll = 1000;
  for (const row of rows) {
    assert.ok(row.decision);
    assert.ok(row.decision.ruleIndex === 0 || row.decision.ruleIndex === -1);
    assert.equal(row.worstLoss, row.decision.values.front * 5 + row.decision.values.back);
    bankroll += row.delta;
    assert.equal(row.bankrollAfter, bankroll);
    assert.equal(row.record.round, row.round);
  }
  assert.notDeepEqual(previewRuleStrategy(strategy, { seed: 2027 }), rows);
});

test("watching a strategy decide (onDecide) changes nothing, and the trace agrees with the decision", async () => {
  const { traceRuleDecision } = await import("../lib/core/rules/trace.ts");
  const rules = SUPERSTITION_TEMPLATES.find((item) => item.id === "chase").strategy;
  registerRuleStrategy(rules, "custom-watch");
  const play = (options) => {
    const rng = mulberry32(4242);
    let table = createTable("niuniu", {
      seats: [
        { profile: { id: "w1", name: "看一", bankroll: 2000 }, control: { kind: "auto", strategyId: "custom-watch" } },
        { profile: { id: "w2", name: "看二", bankroll: 2000 }, control: { kind: "auto", strategyId: "flat" } },
        null,
        null,
        null,
      ],
    });
    for (let round = 0; round < 120 && table.seats.some(Boolean); round += 1) {
      table = dispatch(table, { type: "table/start_round" }, rng);
      table = fillAutoSeats(table, rng, options);
      while (table.phase !== "idle") table = dispatch(table, { type: "table/advance" }, rng);
      table = resolveBustedSeats(table, rng, options);
    }
    return table;
  };
  const events = [];
  const watched = play({ rebuy: true, onDecide: (event) => events.push(event) });
  const plain = play({ rebuy: true });
  assert.deepEqual(watched.roadLog, plain.roadLog);
  assert.equal(watched.playerNet, plain.playerNet);

  const mine = events.filter((event) => event.strategy.id === "custom-watch");
  assert.ok(mine.length > 50);
  let sawRule = false;
  for (const event of mine) {
    const decision = event.strategy.explain(event.input);
    assert.deepEqual(decision.action, event.action);
    const traces = traceRuleDecision(rules, event.input);
    const matched = traces.find((trace) => trace.matched);
    assert.equal(matched ? matched.ruleIndex : -1, decision.ruleIndex);
    if (decision.ruleIndex === 0) {
      sawRule = true;
      // 输多了加码: the check shows this visit's net, below −300.
      assert.ok(matched.checks[0].leftValue < -300);
    }
  }
  assert.ok(sawRule, "the chase rule should fire at least once in 120 rounds");
});

test("share links round-trip; anything tampered or foreign is refused", () => {
  const strategy = SUPERSTITION_TEMPLATES[0].strategy;
  const code = encodeShare(strategy);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeShare(code, "niuniu"), { strategy, issues: [] });
  assert.equal(shareFromHash(`#strategy=${code}`), code);
  assert.equal(shareFromHash("#other=1"), null);

  const tampered = encodeShare({ ...strategy, rules: [{ when: { v: "roundCtx.gameState" }, bet: strategy.otherwise }] });
  const refused = decodeShare(tampered, "niuniu");
  assert.equal(refused.strategy, null);
  assert.ok(refused.issues.some((issue) => /没有这个变量/.test(issue.message)));
  assert.equal(decodeShare("!!!", "niuniu").strategy, null);
  assert.equal(decodeShare("a".repeat(30_000), "niuniu").strategy, null);
});
