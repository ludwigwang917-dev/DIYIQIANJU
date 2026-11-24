import assert from "node:assert/strict";
import test from "node:test";
import "../lib/games/niuniu/index.ts";
import { getGame, getStrategies } from "../lib/core/registry.ts";
import { mulberry32 } from "../lib/core/rng.ts";
import {
  assertZeroSum,
  createTable,
  dispatch,
  pendingSeats,
  viewForSeat,
} from "../lib/core/table.ts";
import { observe } from "../lib/core/observe.ts";

function seatEntry(id, name, bankroll, strategyId = "flat") {
  return {
    profile: { id, name, bankroll },
    control: { kind: "auto", strategyId },
  };
}

function makeTable(bankroll = 1000, strategyId = "flat") {
  return createTable("niuniu", {
    seats: [
      seatEntry("p1", "测一", bankroll, strategyId),
      seatEntry("p2", "测二", bankroll, strategyId),
      null,
      null,
      null,
    ],
  });
}

function autoFillBets(table, rng) {
  const strategies = getStrategies(table.gameId);
  let current = table;
  for (const seatIndex of pendingSeats(current)) {
    const seat = current.seats[seatIndex];
    const strategy = strategies.find((item) => item.id === seat.control.strategyId) ?? strategies[0];
    const action = strategy.act(observe(current, seatIndex));
    current = dispatch(current, { type: "game/action", seatIndex, action }, rng);
  }
  return current;
}

function drainToIdle(table, rng) {
  let current = table;
  while (current.phase !== "idle") {
    if (current.phase === "awaiting_bets") {
      current = autoFillBets(current, rng);
    }
    current = dispatch(current, { type: "table/advance" }, rng);
  }
  return current;
}

function playRound(table, rng) {
  let current = dispatch(table, { type: "table/start_round" }, rng);
  return drainToIdle(current, rng);
}

test("bets are placed before any card is revealed, then all hands open at showdown", () => {
  const rng = mulberry32(7);
  let table = dispatch(makeTable(1000, "flat"), { type: "table/start_round" }, rng);
  assert.equal(table.phase, "awaiting_bets");

  const hidden = (view) => {
    const hands = [view.dealer, ...view.seats.filter((seat) => seat.participating)];
    return hands.every(
      (hand) => hand.label === null && hand.multiplier === null && hand.cards.every((card) => !card.faceUp && card.rank === ""),
    );
  };
  // No seat, not even for its own hand, and not the table overview, may see cards while betting.
  for (const seatIndex of [null, 0, 1]) assert.ok(hidden(viewForSeat(table, seatIndex)), `seat ${seatIndex} sees cards`);

  table = autoFillBets(table, rng);
  assert.ok(hidden(viewForSeat(table, null)), "cards stay hidden until the round advances");
  table = dispatch(table, { type: "table/advance" }, rng);
  assert.equal(table.phase, "showdown");
  const open = viewForSeat(table, 0);
  assert.ok(open.dealer.label && open.dealer.cards.every((card) => card.faceUp));
  assert.ok(open.seats.filter((seat) => seat.participating).every((seat) => seat.label && seat.cards.every((card) => card.faceUp)));
});

test("rejects illegal game actions", () => {
  const rng = mulberry32(1);
  let table = makeTable(1000, "flat");
  assert.throws(() => dispatch(table, { type: "game/action", seatIndex: 0, action: { kind: "place_bet", front: 10, back: 10 } }, rng));

  table = dispatch(table, { type: "table/start_round" }, rng);
  assert.equal(table.phase, "awaiting_bets");

  // Front may be cleared to 0, but at least one chip must be down somewhere.
  assert.throws(
    () => dispatch(table, { type: "game/action", seatIndex: 0, action: { kind: "place_bet", front: 0, back: 0 } }, rng),
    /at least 10/,
  );
  assert.equal(getGame("niuniu").validate(null, 0, { kind: "place_bet", front: 0, back: 10 }), null);
  assert.equal(getGame("niuniu").minStake(), 10);
  assert.throws(() =>
    dispatch(table, { type: "game/action", seatIndex: 0, action: { kind: "place_bet", front: 51, back: 10 } }, rng),
  );
  // Stakes come in 10-point units (2026-11-24): 15 / 5 are not legal amounts.
  assert.throws(
    () => dispatch(table, { type: "game/action", seatIndex: 0, action: { kind: "place_bet", front: 15, back: 10 } }, rng),
    /multiple of 10/,
  );
  assert.throws(
    () => dispatch(table, { type: "game/action", seatIndex: 0, action: { kind: "place_bet", front: 10, back: 5 } }, rng),
    /multiple of 10/,
  );

  table = dispatch(
    table,
    { type: "game/action", seatIndex: 0, action: { kind: "place_bet", front: 10, back: 10 } },
    rng,
  );
  assert.throws(() =>
    dispatch(
      table,
      { type: "game/action", seatIndex: 0, action: { kind: "place_bet", front: 10, back: 10 } },
      rng,
    ),
  );
});

test("maxLoss gate rejects oversized bets at table layer", () => {
  const rng = mulberry32(2);
  let table = makeTable(100, "flat");
  table = dispatch(table, { type: "table/start_round" }, rng);
  // front*5+back = 50*5+100 = 350 > 100
  assert.throws(
    () =>
      dispatch(
        table,
        { type: "game/action", seatIndex: 0, action: { kind: "place_bet", front: 50, back: 100 } },
        rng,
      ),
    /maxLoss/,
  );
  // Strategy modules no longer scale by maxLoss — highroller raw request exceeds bankroll 100.
  const strategies = getStrategies("niuniu");
  const highroller = strategies.find((item) => item.id === "highroller");
  const mod = getGame("niuniu");
  const seat = table.seats[0];
  const spec = mod.actionSpecFor(table.roundCtx.gameState, 0, seat);
  const observed = observe(table, 0);
  const action = highroller.act({ ...observed, spec, me: { ...observed.me, bankroll: 100 } });
  assert.equal(action.front, 50);
  assert.equal(action.back, 100);
  assert.ok(mod.maxLoss(action) > 100);
});

test("phase advance requires all bets then walks to idle", () => {
  const rng = mulberry32(3);
  let table = makeTable(1000, "flat");
  table = dispatch(table, { type: "table/start_round" }, rng);
  assert.equal(table.phase, "awaiting_bets");
  assert.throws(() => dispatch(table, { type: "table/advance" }, rng));

  table = dispatch(
    table,
    { type: "game/action", seatIndex: 0, action: { kind: "place_bet", front: 10, back: 10 } },
    rng,
  );
  assert.throws(() => dispatch(table, { type: "table/advance" }, rng));

  table = dispatch(
    table,
    { type: "game/action", seatIndex: 1, action: { kind: "place_bet", front: 10, back: 10 } },
    rng,
  );
  assert.deepEqual(pendingSeats(table), []);

  table = dispatch(table, { type: "table/advance" }, rng);
  assert.equal(table.phase, "showdown");
  table = dispatch(table, { type: "table/advance" }, rng);
  assert.equal(table.phase, "settled");
  assert.ok(table.roundCtx.settlements);
  table = dispatch(table, { type: "table/advance" }, rng);
  assert.equal(table.phase, "idle");
  assert.equal(table.roundCtx, null);
  assert.equal(table.round, 1);
});

test("strategy outputs always pass module.validate across 100 rounds", () => {
  const mod = getGame("niuniu");
  const strategies = getStrategies("niuniu");
  for (const strategy of strategies) {
    const rng = mulberry32(100 + strategies.indexOf(strategy));
    let table = createTable("niuniu", {
      seats: [
        {
          profile: { id: strategy.id, name: strategy.name, bankroll: 50_000 },
          control: { kind: "auto", strategyId: strategy.id },
        },
        null,
        null,
        null,
        null,
      ],
    });
    for (let round = 0; round < 100; round += 1) {
      if (!table.seats[0]) break;
      table = dispatch(table, { type: "table/start_round" }, rng);
      const seat = table.seats[0];
      const spec = mod.actionSpecFor(table.roundCtx.gameState, 0, seat);
      const action = strategy.act({ ...observe(table, 0), spec });
      assert.equal(mod.validate(table.roundCtx.gameState, 0, action, seat), null);
      table = dispatch(table, { type: "game/action", seatIndex: 0, action }, rng);
      table = drainToIdle(table, rng);
    }
  }
});

test("preserves the explicit zero-sum invariant across rounds via table", () => {
  const rng = mulberry32(24681357);
  let table = makeTable(5000, "flat");
  for (let round = 0; round < 100; round += 1) {
    if (table.seats.every((seat) => seat == null)) break;
    table = playRound(table, rng);
  }
  assertZeroSum(table);
  assert.equal(table.dealerProfit + table.playerNet, 0);
});

test("seeded table and worker-style loop produce identical delta sequences", async () => {
  const { collectRoundDeltas } = await import("../lib/core/auto-play.ts");
  const seed = 424242;
  const rounds = 200;
  const strategyId = "flat";
  const bankroll = 5000;

  const make = () =>
    createTable("niuniu", {
      seats: [
        {
          profile: { id: "seed-a", name: "A", bankroll },
          control: { kind: "auto", strategyId },
        },
        null,
        null,
        null,
        null,
      ],
    });

  const tableDeltas = collectRoundDeltas(make(), strategyId, rounds, mulberry32(seed));
  // Worker-style loop: same createTable + playAutoRound orchestration
  const { playAutoRound } = await import("../lib/core/auto-play.ts");
  const rng = mulberry32(seed);
  let workerTable = make();
  const workerDeltas = [];
  for (let round = 0; round < rounds; round += 1) {
    if (!workerTable.seats.some(Boolean)) break;
    const before = workerTable.playerNet;
    workerTable = playAutoRound(workerTable, strategyId, rng);
    workerDeltas.push(workerTable.playerNet - before);
  }
  assert.deepEqual(workerDeltas, tableDeltas);
});

test("auto seats that cannot afford their strategy bet leave instead of throwing", async () => {
  const { playAutoRound } = await import("../lib/core/auto-play.ts");
  const rng = mulberry32(9);
  // highroller wants front 50 / back 100 → maxLoss 350 > bankroll 100
  let table = makeTable(100, "highroller");
  table = playAutoRound(table, "highroller", rng);
  assert.equal(table.phase, "idle");
  assert.deepEqual(table.seats, [null, null, null, null, null]);
  assert.equal(table.busts.length, 2);
  for (const record of table.busts) {
    assert.equal(record.reason, "insufficient_funds");
    assert.equal(record.bankroll, 100);
    assert.equal(record.roundsPlayed, 0);
  }
  assertZeroSum(table);
  assert.equal(table.totalWagered, 0);
});

test("affordable seats still bet while a broke seat leaves in the same round", async () => {
  const { fillAutoSeats } = await import("../lib/core/auto-play.ts");
  const rng = mulberry32(10);
  let table = createTable("niuniu", {
    seats: [
      seatEntry("rich", "富", 1000, "flat"),
      seatEntry("poor", "穷", 100, "highroller"),
      null,
      null,
      null,
    ],
  });
  table = dispatch(table, { type: "table/start_round" }, rng);
  table = fillAutoSeats(table, rng);
  assert.equal(table.seats[1], null);
  assert.equal(table.busts[0].reason, "insufficient_funds");
  assert.deepEqual(pendingSeats(table), []);
  assert.ok(table.roundCtx.actions[0]);
  assert.equal(table.roundCtx.actions[1], null);
  table = drainToIdle(table, rng);
  assert.equal(table.seats[0].roundsPlayed, 1);
  assert.equal(table.totalWagered, 30);
  assertZeroSum(table);
});

test("table/leave keeps the bankroll, moves no money and respects phases", () => {
  const rng = mulberry32(11);
  let table = makeTable(1000, "flat");
  const left = dispatch(table, { type: "table/leave", seatIndex: 0, reason: "left" }, rng);
  assert.equal(left.seats[0], null);
  assert.deepEqual(
    { reason: left.busts[0].reason, bankroll: left.busts[0].bankroll },
    { reason: "left", bankroll: 1000 },
  );
  assert.equal(left.dealerProfit, 0);
  assert.equal(left.playerNet, 0);
  assert.throws(() => dispatch(left, { type: "table/leave", seatIndex: 0, reason: "left" }, rng));

  table = dispatch(table, { type: "table/start_round" }, rng);
  table = dispatch(
    table,
    { type: "game/action", seatIndex: 0, action: { kind: "place_bet", front: 10, back: 10 } },
    rng,
  );
  // A seat that already bet must wait for settlement.
  assert.throws(() => dispatch(table, { type: "table/leave", seatIndex: 0, reason: "left" }, rng));
  table = dispatch(table, { type: "table/leave", seatIndex: 1, reason: "left" }, rng);
  assert.deepEqual(pendingSeats(table), []);
  table = dispatch(table, { type: "table/advance" }, rng);
  assert.equal(table.phase, "showdown");
  assert.throws(() => dispatch(table, { type: "table/leave", seatIndex: 0, reason: "left" }, rng));
  table = drainToIdle(table, rng);
  assert.equal(table.roundCtx, null);
  assertZeroSum(table);
});

test("monte carlo counts insufficient-funds exits as leaving, not surviving", async () => {
  const { runMonteCarlo } = await import("../lib/core/monte-carlo.ts");
  const result = runMonteCarlo({
    gameId: "niuniu",
    runs: 200,
    maxRounds: 1000,
    bankroll: 1000,
    strategyId: "highroller",
    seed: 1,
  });
  // Before the fix ~96% of these runs were silently counted as survivors.
  assert.ok(result.bankruptcyRate > 0.9, `bankruptcyRate ${result.bankruptcyRate}`);
  assert.ok(result.insufficientCount > 0);
  assert.equal(result.survivorCount + result.bustCount + result.insufficientCount, result.runs);
  assert.equal(result.buckets.reduce((sum, value) => sum + value, 0), result.runs - result.survivorCount);
  assert.ok(result.averageEndingBankroll > 0);
});

test("monte carlo is reproducible with the same seed", async () => {
  const { runMonteCarlo } = await import("../lib/core/monte-carlo.ts");
  const request = { gameId: "niuniu", runs: 30, maxRounds: 300, bankroll: 1000, strategyId: "martingale", seed: 7 };
  assert.deepEqual(runMonteCarlo(request), runMonteCarlo(request));
});

test("human and auto channels are equivalent for the same action sequence", () => {
  const seed = 777001;
  const action = { kind: "place_bet", front: 10, back: 20 };

  const baseSeats = [
    {
      profile: { id: "h1", name: "人一", bankroll: 2000 },
      control: { kind: "human" },
    },
    {
      profile: { id: "h2", name: "人二", bankroll: 2000 },
      control: { kind: "human" },
    },
    null,
    null,
    null,
  ];

  const autoSeats = [
    {
      profile: { id: "a1", name: "机一", bankroll: 2000 },
      control: { kind: "auto", strategyId: "flat" },
    },
    {
      profile: { id: "a2", name: "机二", bankroll: 2000 },
      control: { kind: "auto", strategyId: "flat" },
    },
    null,
    null,
    null,
  ];

  function runWithActions(seats, human) {
    const rng = mulberry32(seed);
    let table = createTable("niuniu", { seats });
    table = dispatch(table, { type: "table/start_round" }, rng);
    for (const seatIndex of pendingSeats(table)) {
      table = dispatch(
        table,
        { type: "game/action", seatIndex, action },
        rng,
      );
    }
    while (table.phase !== "idle") {
      table = dispatch(table, { type: "table/advance" }, rng);
    }
    return {
      round: table.round,
      dealerProfit: table.dealerProfit,
      playerNet: table.playerNet,
      totalWagered: table.totalWagered,
      bankrolls: table.seats.map((seat) => seat?.bankroll ?? null),
      histories: table.seats.map((seat) => seat?.history ?? null),
      human,
    };
  }

  const humanEnd = runWithActions(baseSeats, true);
  const autoEnd = runWithActions(autoSeats, false);
  assert.equal(humanEnd.round, autoEnd.round);
  assert.equal(humanEnd.dealerProfit, autoEnd.dealerProfit);
  assert.equal(humanEnd.playerNet, autoEnd.playerNet);
  assert.equal(humanEnd.totalWagered, autoEnd.totalWagered);
  assert.deepEqual(humanEnd.bankrolls, autoEnd.bankrolls);
  assert.deepEqual(humanEnd.histories, autoEnd.histories);
});

// ---- Rebuy: the same player buys in again at the moment they would leave (§2.3 #8) ----

const HUMAN_BET_MIN = { kind: "place_bet", front: 10, back: 0 }; // maxLoss 50 = minStake

/** One human seat with bankroll 50 bets the minimum until a seed busts it to exactly 0. */
function bustHumanSeat() {
  for (let seed = 1; seed < 5000; seed += 1) {
    const rng = mulberry32(seed);
    let table = createTable("niuniu", {
      seats: [{ profile: { id: "h", name: "人", bankroll: 50 }, control: { kind: "human" } }, null, null, null, null],
    });
    table = dispatch(table, { type: "table/start_round" }, rng);
    table = dispatch(table, { type: "game/action", seatIndex: 0, action: HUMAN_BET_MIN }, rng);
    while (table.phase !== "idle") table = dispatch(table, { type: "table/advance" }, rng);
    if (table.seats[0].bankroll === 0) return { table, rng };
  }
  throw new Error("no busting seed found");
}

test("a bust seat stays seated and blocks the next round until it rebuys or leaves", () => {
  const { table, rng } = bustHumanSeat();
  assert.equal(table.seats[0].bankroll, 0);
  assert.equal(table.busts.length, 0);
  assert.throws(() => dispatch(table, { type: "table/start_round" }, rng), /rebuy or leave/);
  // A bust seat can only leave as bankrupt, and a solvent one never can.
  assert.throws(() => dispatch(table, { type: "table/leave", seatIndex: 0, reason: "left" }, rng));
  const left = dispatch(table, { type: "table/leave", seatIndex: 0, reason: "bankrupt" }, rng);
  assert.equal(left.seats[0], null);
  assert.deepEqual(
    { reason: left.busts[0].reason, bankroll: left.busts[0].bankroll, buyIns: left.busts[0].buyIns, totalBuyIn: left.busts[0].totalBuyIn },
    { reason: "bankrupt", bankroll: 0, buyIns: 1, totalBuyIn: 50 },
  );
  assert.throws(() =>
    dispatch(makeTable(1000), { type: "table/leave", seatIndex: 0, reason: "bankrupt" }, rng),
  );
});

test("rebuy tracks buy-ins and leaves the zero-sum ledger untouched", () => {
  const { table, rng } = bustHumanSeat();
  const dealerProfit = table.dealerProfit;
  assert.throws(() => dispatch(table, { type: "table/rebuy", seatIndex: 0, amount: 0 }, rng));
  assert.throws(() => dispatch(table, { type: "table/rebuy", seatIndex: 0, amount: 55 }, rng), /multiple of 10/);
  assert.throws(() => dispatch(table, { type: "table/rebuy", seatIndex: 0, amount: 510 }, rng), /limit/);
  let next = dispatch(table, { type: "table/rebuy", seatIndex: 0, amount: 50 }, rng);
  const seat = next.seats[0];
  assert.equal(seat.bankroll, 50);
  assert.equal(seat.buyIns, 2);
  assert.equal(seat.totalBuyIn, 100);
  assert.deepEqual(seat.rebuys, [{ round: 1, roundsPlayed: 1, before: 0, amount: 50 }]);
  assert.equal(next.dealerProfit, dealerProfit);
  assertZeroSum(next);
  // Once solvent again it cannot top up between rounds.
  assert.throws(() => dispatch(next, { type: "table/rebuy", seatIndex: 0, amount: 10 }, rng), /cannot afford/);
  next = dispatch(next, { type: "table/start_round" }, rng);
  next = dispatch(next, { type: "game/action", seatIndex: 0, action: HUMAN_BET_MIN }, rng);
  next = drainToIdle(next, rng);
  assert.equal(next.round, 2);
  assert.equal(next.seats[0].history.length, 3);
  assertZeroSum(next);
});

test("rebuy for an intended bet is only allowed when that bet is unaffordable", () => {
  const rng = mulberry32(31);
  let table = createTable("niuniu", {
    seats: [{ profile: { id: "h", name: "人", bankroll: 100 }, control: { kind: "human" } }, null, null, null, null],
  });
  const big = { kind: "place_bet", front: 50, back: 100 }; // maxLoss 350
  assert.throws(() => dispatch(table, { type: "table/rebuy", seatIndex: 0, amount: 300, intended: big }, rng));
  table = dispatch(table, { type: "table/start_round" }, rng);
  assert.throws(
    () => dispatch(table, { type: "table/rebuy", seatIndex: 0, amount: 300, intended: { kind: "place_bet", front: 10, back: 10 } }, rng),
    /no rebuy needed/,
  );
  assert.throws(() => dispatch(table, { type: "table/rebuy", seatIndex: 0, amount: 300, intended: { kind: "place_bet", front: 51, back: 0 } }, rng));
  assert.throws(() => dispatch(table, { type: "table/rebuy", seatIndex: 0, amount: 200, intended: big }, rng), /below 350/);
  table = dispatch(table, { type: "table/rebuy", seatIndex: 0, amount: 250, intended: big }, rng);
  assert.equal(table.seats[0].bankroll, 350);
  table = dispatch(table, { type: "game/action", seatIndex: 0, action: big }, rng);
  assert.throws(() => dispatch(table, { type: "table/rebuy", seatIndex: 0, amount: 10, intended: big }, rng), /already bet/);
  table = drainToIdle(table, rng);
  assertZeroSum(table);
});

test("auto rebuy is random, seeded, capped at 5 and sized 50%–150% of the first buy-in", async () => {
  const { playAutoRound, AUTO_REBUY } = await import("../lib/core/auto-play.ts");
  const run = (seed) => {
    const rng = mulberry32(seed);
    let table = createTable("niuniu", {
      seats: [seatEntry("a", "甲", 400, "highroller"), seatEntry("b", "乙", 400, "martingale"), null, null, null],
    });
    for (let round = 0; round < 400 && table.seats.some(Boolean); round += 1) {
      table = playAutoRound(table, "highroller", rng, { rebuy: true });
    }
    return table;
  };
  let sawRebuy = false;
  let sawNoRebuy = false;
  for (let seed = 1; seed <= 20; seed += 1) {
    const table = run(seed);
    assert.deepEqual(run(seed), table, "same seed must replay identically");
    assertZeroSum(table);
    const players = [
      ...table.seats.filter(Boolean),
      ...table.busts,
    ];
    for (const player of players) {
      assert.ok(player.buyIns - 1 <= AUTO_REBUY.maxRebuys);
      if (player.buyIns > 1) sawRebuy = true;
      else sawNoRebuy = true;
    }
    for (const seat of table.seats.filter(Boolean)) {
      assert.equal(seat.rebuys.length, seat.buyIns - 1);
      assert.equal(seat.totalBuyIn, 400 + seat.rebuys.reduce((sum, item) => sum + item.amount, 0));
      for (const rebuy of seat.rebuys) {
        assert.equal(rebuy.amount % 10, 0);
        assert.ok(rebuy.amount >= 200 && rebuy.amount <= 600 || rebuy.before + rebuy.amount <= 360);
      }
    }
  }
  assert.ok(sawRebuy && sawNoRebuy, "over 20 seeds both outcomes should appear");
});

test("stakes, payouts, rebuys and bankrolls all stay in 10-point units", async () => {
  const { playAutoRound } = await import("../lib/core/auto-play.ts");
  const unit = getGame("niuniu").pointUnit();
  assert.equal(unit, 10);
  for (const strategy of getStrategies("niuniu")) {
    const rng = mulberry32(7);
    let table = createTable("niuniu", {
      seats: [seatEntry("a", "甲", 600, strategy.id), seatEntry("b", "乙", 1600, strategy.id), null, null, null],
    });
    for (let round = 0; round < 300 && table.seats.some(Boolean); round += 1) {
      table = playAutoRound(table, strategy.id, rng, { rebuy: true });
    }
    const players = [...table.seats.filter(Boolean), ...table.busts];
    for (const player of players) {
      for (const value of player.history ?? []) assert.equal(value % unit, 0, `${strategy.id} history ${value}`);
      assert.equal(player.bankroll % unit, 0, `${strategy.id} bankroll ${player.bankroll}`);
      assert.equal(player.totalBuyIn % unit, 0);
    }
    assert.equal(Math.abs(table.dealerProfit) % unit, 0);
    assertZeroSum(table);
  }
});

test("monte carlo with rebuy reports buy-ins and is reproducible", async () => {
  const { runMonteCarlo } = await import("../lib/core/monte-carlo.ts");
  const base = { gameId: "niuniu", runs: 200, maxRounds: 1000, bankroll: 1000, strategyId: "highroller", seed: 1 };
  const off = runMonteCarlo(base);
  const on = runMonteCarlo({ ...base, rebuy: true });
  assert.deepEqual(runMonteCarlo({ ...base, rebuy: true }), on);
  assert.equal(off.rebuy, false);
  assert.equal(off.averageRebuys, 0);
  assert.equal(off.averageTotalBuyIn, 1000);
  assert.equal(on.rebuy, true);
  assert.ok(on.averageRebuys > 0 && on.averageRebuys <= 5);
  assert.ok(on.averageTotalBuyIn > 1000);
  assert.equal(on.survivorCount + on.bustCount + on.insufficientCount, on.runs);
  assert.ok(Math.abs(on.averageNetLoss - (on.averageTotalBuyIn - on.averageEndingBankroll)) < 1e-6);
  // Rebuying postpones leaving but costs more overall.
  assert.ok(on.bankruptcyRate < off.bankruptcyRate, `${on.bankruptcyRate} vs ${off.bankruptcyRate}`);
  assert.ok(on.averageNetLoss > off.averageNetLoss, `${on.averageNetLoss} vs ${off.averageNetLoss}`);
});

// ---------- 一次进场的计划与生涯总账（2026-11-24） ----------

test("seat_player requires an amount brought; the plan is optional and validated", () => {
  const rng = mulberry32(5);
  const empty = createTable("niuniu", { seats: [null, null, null, null, null] });
  const sit = (table, seatIndex, profile, plan) =>
    dispatch(table, { type: "table/seat_player", seatIndex, profile, control: { kind: "human" }, plan }, rng);
  assert.throws(() => sit(empty, 0, { id: "a", name: "甲", bankroll: 0 }), /minimum stake/);
  assert.throws(() => sit(empty, 0, { id: "a", name: "甲", bankroll: 5 }), /minimum stake|multiple/);
  assert.throws(() => sit(empty, 0, { id: "a", name: "甲", bankroll: 105 }), /multiple of 10/);
  assert.throws(() => sit(empty, 0, { id: "a", name: "甲", bankroll: 500 }, { stopWin: 0 }), /positive integer/);
  assert.throws(() => sit(empty, 0, { id: "a", name: "甲", bankroll: 500 }, { maxRounds: 2.5 }), /positive integer/);
  const one = sit(empty, 0, { id: "a", name: "甲", bankroll: 500 });
  assert.deepEqual(one.seats[0].plan, {});
  assert.equal(one.seats[0].personId, "a");
  // The seat must be empty, and one person cannot take two seats.
  assert.throws(() => sit(one, 0, { id: "b", name: "乙", bankroll: 500 }), /taken/);
  assert.throws(() => sit(one, 1, { id: "a-2", personId: "a", name: "甲", bankroll: 500 }), /already seated/);
  const two = sit(one, 1, { id: "b", name: "乙", bankroll: 500 }, { stopWin: 100, maxRounds: 20 });
  assert.deepEqual(two.seats[1].plan, { stopWin: 100, maxRounds: 20 });
});

test("visit plans make seats leave between rounds, human and auto alike, with honest reasons", async () => {
  const { applyVisitPlans, playAutoRound } = await import("../lib/core/auto-play.ts");
  const rng = mulberry32(77);
  let table = createTable("niuniu", {
    seats: [
      { profile: { id: "t", name: "限时", bankroll: 1000 }, control: { kind: "auto", strategyId: "flat" }, plan: { maxRounds: 3 } },
      null, null, null, null,
    ],
  });
  for (let round = 0; round < 3; round += 1) table = playAutoRound(table, "flat", rng);
  assert.equal(table.seats[0], null);
  assert.equal(table.busts[0].reason, "time_up");
  assert.equal(table.busts[0].roundsPlayed, 3);

  // A plan reason that has not been reached is refused.
  const fresh = createTable("niuniu", {
    seats: [{ profile: { id: "h", name: "人", bankroll: 1000 }, control: { kind: "human" }, plan: { stopWin: 100 } }, null, null, null, null],
  });
  assert.throws(() => dispatch(fresh, { type: "table/leave", seatIndex: 0, reason: "stop_win" }, rng), /not reached/);
  assert.throws(() => dispatch(fresh, { type: "table/leave", seatIndex: 0, reason: "time_up" }, rng), /not reached/);
  assert.equal(applyVisitPlans(fresh, rng), fresh);

  // The same plan on a human seat is carried out the same way once it is met.
  let human = fresh;
  for (let guard = 0; guard < 400 && human.seats[0] && human.seats[0].bankroll >= 350; guard += 1) {
    human = dispatch(human, { type: "table/start_round" }, rng);
    human = dispatch(human, { type: "game/action", seatIndex: 0, action: { kind: "place_bet", front: 50, back: 100 } }, rng);
    human = drainToIdle(human, rng);
    human = applyVisitPlans(human, rng);
  }
  const record = human.busts[0];
  assert.ok(record, "this seed reaches the stop-win");
  assert.equal(record.reason, "stop_win");
  assert.ok(record.bankroll - record.totalBuyIn >= 100);
  assertZeroSum(human);
});

test("no rebuy past the stop-loss line, by hand or by the auto player", async () => {
  const { resolveBustedSeats } = await import("../lib/core/auto-play.ts");
  const { table, rng } = bustHumanSeat();
  const withPlan = {
    ...table,
    seats: table.seats.map((seat, index) => (index === 0 ? { ...seat, plan: { stopLoss: 50 } } : seat)),
  };
  assert.throws(() => dispatch(withPlan, { type: "table/rebuy", seatIndex: 0, amount: 50 }, rng), /stop-loss/);
  // Without the plan the same rebuy is fine.
  assert.equal(dispatch(table, { type: "table/rebuy", seatIndex: 0, amount: 50 }, rng).seats[0].buyIns, 2);
  // An auto seat in the same spot leaves as bankrupt instead of rebuying, every time.
  const autoSeat = {
    ...withPlan,
    seats: withPlan.seats.map((seat, index) =>
      index === 0 ? { ...seat, control: { kind: "auto", strategyId: "flat" } } : seat,
    ),
  };
  for (let seed = 1; seed <= 20; seed += 1) {
    const after = resolveBustedSeats(autoSeat, mulberry32(seed), { rebuy: true });
    assert.equal(after.seats[0], null);
    assert.equal(after.busts[0].reason, "bankrupt");
    assert.equal(after.busts[0].buyIns, 1);
  }
});

test("lifetime ledger follows each person across visits and adds up to the table's books", async () => {
  const { playAutoRound } = await import("../lib/core/auto-play.ts");
  const { lifetimeLedgers } = await import("../lib/core/lifetime.ts");
  const rng = mulberry32(2026);
  const people = {
    a: { name: "甲", strategyId: "aggressive", plan: { maxRounds: 10 }, seatIndex: 0 },
    b: { name: "乙", strategyId: "flat", plan: { maxRounds: 15 }, seatIndex: 1 },
  };
  const visitsBy = { a: 0, b: 0 };
  const sitDown = (table, personId) => {
    const person = people[personId];
    visitsBy[personId] += 1;
    return dispatch(table, {
      type: "table/seat_player",
      seatIndex: person.seatIndex,
      profile: { id: `${personId}-${visitsBy[personId]}`, personId, name: person.name, bankroll: 500 },
      control: { kind: "auto", strategyId: person.strategyId },
      plan: person.plan,
    }, rng);
  };
  let table = sitDown(sitDown(createTable("niuniu", { seats: [null, null, null, null, null] }), "a"), "b");
  for (let round = 0; round < 120; round += 1) {
    table = playAutoRound(table, undefined, rng, { rebuy: true });
    for (const personId of ["a", "b"]) {
      if (!table.seats[people[personId].seatIndex]) table = sitDown(table, personId);
    }
  }
  const ledgers = lifetimeLedgers(table);
  assert.deepEqual(ledgers.map((item) => item.personId), ["a", "b"]);
  for (const ledger of ledgers) {
    assert.ok(ledger.visits.length >= 3, `${ledger.personId} visited ${ledger.visits.length} times`);
    assert.equal(ledger.visits.length, visitsBy[ledger.personId]);
    assert.equal(ledger.finishedVisits, ledger.visits.length - 1);
    assert.equal(ledger.visits.at(-1).reason, null);
    assert.equal(ledger.seatIndex, people[ledger.personId].seatIndex);
    assert.equal(ledger.lifetimeNet, ledger.visits.reduce((sum, visit) => sum + visit.net, 0));
    assert.equal(ledger.winningVisits, ledger.visits.filter((visit) => visit.reason && visit.net > 0).length);
  }
  // Every point a player won or lost came from the dealer: lifetime totals match the table.
  const total = ledgers.reduce((sum, ledger) => sum + ledger.lifetimeNet, 0);
  assert.equal(total, table.playerNet);
  assertZeroSum(table);
});

test("lifetime experiment: leaving while ahead wins more visits but the lifetime total still loses", async () => {
  const { runLifetimeExperiment } = await import("../lib/core/monte-carlo.ts");
  const base = {
    gameId: "niuniu", people: 200, visits: 30, bankroll: 1000, strategyId: "flat",
    maxRoundsPerVisit: 1000, seed: 20261124, rebuy: false,
  };
  const quitWhileAhead = runLifetimeExperiment({ ...base, plan: { stopWin: 100, stopLoss: 500 } });
  assert.deepEqual(runLifetimeExperiment({ ...base, plan: { stopWin: 100, stopLoss: 500 } }), quitWhileAhead);
  const counted = Object.values(quitWhileAhead.reasons).reduce((sum, count) => sum + count, 0);
  assert.equal(counted, base.people * base.visits);
  assert.ok(quitWhileAhead.winningVisitRate > 0.5, `winning visits ${quitWhileAhead.winningVisitRate}`);
  assert.ok(quitWhileAhead.averageLifetimeNet < 0, `lifetime ${quitWhileAhead.averageLifetimeNet}`);
  assert.ok(quitWhileAhead.netPerWagered < 0);
});

// ---------- 多桌大厅与换桌（2026-11-24） ----------

function twoTables() {
  const auto = (id, name, strategyId, plan) => ({
    profile: { id: `${id}#1`, personId: id, name, bankroll: 1000 },
    control: { kind: "auto", strategyId },
    plan,
  });
  return [
    createTable("niuniu", { seats: [auto("a", "甲", "flat", { maxRounds: 4 }), auto("b", "乙", "flat"), null, null, null] }),
    createTable("niuniu", { seats: [auto("c", "丙", "flat"), null, null, null, null], dealerIndex: 2 }),
  ];
}

test("every settled round lands on the table's road, matching the dealer's books", async () => {
  const { playAutoRound } = await import("../lib/core/auto-play.ts");
  const { roadMark } = await import("../lib/core/casino.ts");
  const { ROAD_LOG_SIZE } = await import("../lib/core/table.ts");
  const rng = mulberry32(404);
  let table = twoTables()[1];
  for (let round = 0; round < ROAD_LOG_SIZE + 10; round += 1) {
    const before = table.dealerProfit;
    table = playAutoRound(table, "flat", rng);
    const last = table.roadLog.at(-1);
    assert.equal(last.round, table.round);
    assert.equal(last.dealerDelta, table.dealerProfit - before);
    assert.equal(last.playerWins + last.playerLosses <= 1, true);
  }
  assert.equal(table.roadLog.length, ROAD_LOG_SIZE);
  assert.equal(roadMark({ round: 1, dealerDelta: 30, playerWins: 0, playerLosses: 2 }), "dealer_sweep");
  assert.equal(roadMark({ round: 1, dealerDelta: 10, playerWins: 1, playerLosses: 2 }), "dealer");
  assert.equal(roadMark({ round: 1, dealerDelta: -10, playerWins: 2, playerLosses: 1 }), "players");
  assert.equal(roadMark({ round: 1, dealerDelta: -40, playerWins: 2, playerLosses: 0 }), "players_sweep");
  assert.equal(roadMark({ round: 1, dealerDelta: 0, playerWins: 1, playerLosses: 1 }), "even");
});

test("switching tables carries the chips and the visit; both tables stay zero-sum", async () => {
  const { playAutoRound } = await import("../lib/core/auto-play.ts");
  const { seatAt, seatOf, switchTable } = await import("../lib/core/casino.ts");
  const { lifetimeLedgers } = await import("../lib/core/lifetime.ts");
  const rng = mulberry32(99);
  let tables = twoTables();
  tables[0] = playAutoRound(playAutoRound(tables[0], undefined, rng), undefined, rng);
  const before = tables[0].seats[0];
  assert.equal(before.roundsPlayed, 2);

  // Only between rounds at both tables, only to an empty seat.
  const midRound = [tables[0], dispatch(tables[1], { type: "table/start_round" }, rng)];
  assert.throws(() => switchTable(midRound, { tableIndex: 0, seatIndex: 0 }, { tableIndex: 1, seatIndex: 1 }, rng, "a#2"), /between rounds/);
  assert.throws(() => switchTable(tables, { tableIndex: 0, seatIndex: 0 }, { tableIndex: 1, seatIndex: 0 }, rng, "a#2"), /taken/);
  // A seated person cannot also sit down at another table.
  assert.throws(
    () => seatAt(tables, 1, { type: "table/seat_player", seatIndex: 2, profile: { id: "a#9", personId: "a", name: "甲", bankroll: 500 }, control: { kind: "human" } }, rng),
    /already seated at table 1/,
  );

  tables = switchTable(tables, { tableIndex: 0, seatIndex: 0 }, { tableIndex: 1, seatIndex: 3 }, rng, "a#2");
  assert.equal(tables[0].seats[0], null);
  assert.equal(tables[0].busts[0].reason, "switch_table");
  const moved = tables[1].seats[3];
  assert.deepEqual(seatOf(tables, "a"), { tableIndex: 1, seatIndex: 3 });
  for (const key of ["bankroll", "visitId", "initialBankroll", "totalBuyIn", "buyIns", "roundsPlayed", "wins", "lossStreak", "lastOutcome"]) {
    assert.deepEqual(moved[key], before[key], key);
  }
  assert.deepEqual(moved.plan, { maxRounds: 4 });
  // The plan keeps counting: 2 rounds here + 2 there, then home.
  tables[1] = playAutoRound(playAutoRound(tables[1], undefined, rng), undefined, rng);
  assert.equal(tables[1].seats[3], null);
  assert.equal(tables[1].busts[0].reason, "time_up");
  assert.equal(tables[1].busts[0].roundsPlayed, 4);
  for (const table of tables) assertZeroSum(table);

  // One trip across two tables is one visit in the lifetime ledger.
  const ledger = lifetimeLedgers(tables).find((item) => item.personId === "a");
  assert.equal(ledger.visits.length, 1);
  assert.deepEqual(ledger.visits[0].tables, [0, 1]);
  assert.equal(ledger.visits[0].reason, "time_up");
  assert.equal(ledger.visits[0].rounds, 4);
  assert.equal(ledger.finishedVisits, 1);
  const total = lifetimeLedgers(tables).reduce((sum, item) => sum + item.lifetimeNet, 0);
  assert.equal(total, tables[0].playerNet + tables[1].playerNet);
});

// ---- Strategy observation (docs/strategy-editor-design.md, step 1) ----

function threeAutoSeats(bankroll = 2000) {
  return createTable("niuniu", {
    seats: [
      seatEntry("o1", "观一", bankroll, "flat"),
      seatEntry("o2", "观二", bankroll, "martingale"),
      seatEntry("o3", "观三", bankroll, "adaptive"),
      null,
      null,
    ],
  });
}

test("observation is blind to this round's cards: change only the deck, nothing a seat sees changes", async () => {
  const { playAutoRound } = await import("../lib/core/auto-play.ts");
  const rng = mulberry32(20261124);
  let table = threeAutoSeats();
  for (let round = 0; round < 25; round += 1) table = playAutoRound(table, "flat", rng);
  assert.equal(table.phase, "idle");

  let differentDecks = 0;
  for (let trial = 0; trial < 20; trial += 1) {
    let a = dispatch(table, { type: "table/start_round" }, mulberry32(1000 + trial));
    let b = dispatch(table, { type: "table/start_round" }, mulberry32(5000 + trial));
    if (JSON.stringify(a.roundCtx.gameState) !== JSON.stringify(b.roundCtx.gameState)) {
      differentDecks += 1;
    }
    // Walk both tables through the same bets, seat by seat: every seat must see the same thing.
    for (const seatIndex of [0, 1, 2]) {
      const seenA = observe(a, seatIndex);
      const seenB = observe(b, seatIndex);
      assert.deepEqual(seenA, seenB, `seat ${seatIndex}, trial ${trial}`);
      // Nothing about this round names a card.
      const text = JSON.stringify({ view: seenA.view, me: seenA.me, seats: seenA.seats });
      assert.ok(!/"rank":"[^"]+"/.test(text), "a face-down card leaked its rank");
      const bet = { kind: "place_bet", front: 10 * (seatIndex + 1), back: 20 };
      a = dispatch(a, { type: "game/action", seatIndex, action: bet }, rng);
      b = dispatch(b, { type: "game/action", seatIndex, action: bet }, rng);
    }
  }
  assert.ok(differentDecks >= 19, "the two decks should really differ");
});

test("seats bet in seat order; auto seats stop at a human seat and resume after it", async () => {
  const { fillAutoSeats } = await import("../lib/core/auto-play.ts");
  const { nextToAct } = await import("../lib/core/table.ts");
  const rng = mulberry32(42);
  let table = threeAutoSeats();
  table = dispatch(table, { type: "table/set_control", seatIndex: 1, control: { kind: "human" } }, rng);
  table = dispatch(table, { type: "table/start_round" }, rng);
  const bet = { kind: "place_bet", front: 10, back: 10 };
  assert.throws(() => dispatch(table, { type: "game/action", seatIndex: 2, action: bet }, rng), /seat order/);

  table = fillAutoSeats(table, rng);
  assert.notEqual(table.roundCtx.actions[0], null, "seat 0 (auto) bets first");
  assert.equal(table.roundCtx.actions[2], null, "seat 2 (auto) waits behind the human");
  assert.equal(nextToAct(table), 1);

  // The human sees seat 0's chips on the felt, and nobody else's.
  const seen = observe(table, 1);
  assert.deepEqual(seen.seats[0].betThisRound, table.roundCtx.actions[0]);
  assert.equal(seen.seats[2].betThisRound, null);
  assert.equal(seen.me.betPosition, 2);
  assert.equal(seen.me.alreadyBet, 1);

  table = dispatch(table, { type: "game/action", seatIndex: 1, action: bet }, rng);
  table = fillAutoSeats(table, rng);
  assert.notEqual(table.roundCtx.actions[2], null);
  assert.deepEqual(pendingSeats(table), []);
});

test("the public record keeps every revealed hand and bet; observe() reads it back consistently", async () => {
  const { playAutoRound } = await import("../lib/core/auto-play.ts");
  const { DEALER_SHIFT } = await import("../lib/core/table.ts");
  const rng = mulberry32(777);
  let table = threeAutoSeats(5000);
  for (let round = 0; round < DEALER_SHIFT - 1; round += 1) {
    const before = table;
    table = playAutoRound(table, "martingale", rng);
    const last = table.roadLog.at(-1);
    assert.equal(last.round, table.round);
    assert.equal(last.dealerIndex, before.dealerIndex);
    const seatTotal = last.seats.reduce((sum, item) => sum + item.delta, 0);
    assert.equal(seatTotal, -last.dealerDelta);
    assert.equal(last.detail.seats.length, last.seats.length);
    assert.equal(last.detail.dealer.cards.length, 5);
    for (const hand of [last.detail.dealer, ...last.detail.seats]) {
      assert.ok(hand.cattle >= 0 && hand.cattle <= 10);
      assert.ok(hand.cards.every((card) => card.rank && card.suit));
    }
    for (const entry of last.seats) {
      const seat = table.seats[entry.seatIndex];
      if (!seat) continue;
      assert.deepEqual(seat.lastAction, entry.bet);
      assert.ok(seat.winStreak === 0 || seat.lossStreak === 0, "one streak is always 0");
    }
  }

  const seen = observe(table, 0);
  assert.equal(seen.history, table.roadLog, "history is the table's own record, not a copy");
  assert.equal(seen.round, DEALER_SHIFT);
  assert.equal(seen.dealer.roundsThisShift, DEALER_SHIFT - 1);
  assert.equal(seen.dealer.roundsLeftInShift, 1, "round 30 is this dealer's last");
  const lastDelta = table.roadLog.at(-1).dealerDelta;
  if (lastDelta !== 0) {
    assert.equal(seen.dealer.streak.outcome, lastDelta > 0 ? "win" : "loss");
    assert.ok(seen.dealer.streak.length >= 1);
  }
  // My plan is private: other seats do not carry theirs.
  assert.ok("plan" in seen.me);
  assert.ok(!("plan" in seen.seats[1]));

  table = playAutoRound(table, "martingale", rng);
  assert.equal(observe(table, 0).dealer.roundsThisShift, 0, "a new dealer starts a new shift");
  assert.equal(observe(table, 0).dealer.roundsLeftInShift, DEALER_SHIFT);
});

test("every variable in the observation catalog resolves to a value of its declared type", async () => {
  const { playAutoRound } = await import("../lib/core/auto-play.ts");
  const { observationCatalog } = await import("../lib/core/observe.ts");
  const rng = mulberry32(99);
  let table = createTable("niuniu", {
    seats: [
      { ...seatEntry("c1", "目一", 3000), plan: { stopWin: 5000, stopLoss: 2500, maxRounds: 500 } },
      seatEntry("c2", "目二", 3000),
      seatEntry("c3", "目三", 3000),
      null,
      null,
    ],
  });
  for (let round = 0; round < 12; round += 1) table = playAutoRound(table, "flat", rng);
  table = dispatch(table, { type: "table/leave", seatIndex: 2, reason: "left" }, rng);
  table = dispatch(table, { type: "table/start_round" }, rng);
  table = dispatch(table, { type: "game/action", seatIndex: 0, action: { kind: "place_bet", front: 10, back: 10 } }, rng);
  const seen = observe(table, 1);

  // Follow a path like "history[].detail.seats[].label" into every non-null item of each list.
  const resolve = (root, path) => {
    let values = [root];
    for (const part of path.split(".")) {
      const isList = part.endsWith("[]");
      const key = isList ? part.slice(0, -2) : part;
      values = values.flatMap((value) => {
        const next = value?.[key];
        return isList ? (Array.isArray(next) ? next.filter((item) => item != null) : []) : [next];
      });
    }
    return values;
  };

  const catalog = observationCatalog("niuniu");
  assert.ok(catalog.length > 60);
  assert.equal(new Set(catalog.map((field) => field.path)).size, catalog.length, "paths are unique");
  for (const field of catalog) {
    const values = resolve(seen, field.path);
    assert.ok(values.length > 0, `${field.path} resolves to nothing`);
    const present = values.filter((value) => value != null);
    if (!field.nullable) assert.equal(present.length, values.length, `${field.path} has null values`);
    for (const value of present) {
      if (field.type === "number") assert.equal(typeof value, "number", field.path);
      if (field.type === "text") assert.equal(typeof value, "string", field.path);
      if (field.type === "boolean") assert.equal(typeof value, "boolean", field.path);
      if (field.type === "enum") {
        assert.ok(field.values.some((option) => option.value === value), `${field.path} = ${value}`);
      }
    }
  }
});
