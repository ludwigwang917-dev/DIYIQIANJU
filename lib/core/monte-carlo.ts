import { playAutoRound } from "./auto-play.ts";
import { mulberry32 } from "./rng.ts";
import { registerRuleStrategy } from "./rules/compile.ts";
import { createTable } from "./table.ts";
import type { LeaveReason, VisitPlan } from "./types.ts";

export interface MonteCarloRequest {
  gameId: string;
  runs: number;
  maxRounds: number;
  bankroll: number;
  strategyId: string;
  seed?: number;
  /** Let the player randomly rebuy instead of leaving (AUTO_REBUY in auto-play.ts). */
  rebuy?: boolean;
  /**
   * A strategy built in the strategy editor. When given, it is compiled and registered under
   * `strategyId` first (a worker cannot see strategies registered on the page).
   */
  rules?: unknown;
}

export interface MonteCarloResult {
  runs: number;
  maxRounds: number;
  rebuy: boolean;
  /** Share of runs that left the table within maxRounds (bankrupt + insufficient funds). */
  bankruptcyRate: number;
  /** Runs that ended with bankroll 0 and no further rebuy. */
  bustCount: number;
  /** Runs that left because the strategy's next bet could lose more than the bankroll. */
  insufficientCount: number;
  /** Median number of rounds actually played before leaving; null if nobody left. */
  medianBustRound: number | null;
  survivorCount: number;
  /** Average bankroll at the end: what survivors hold, or what leavers walked away with. */
  averageEndingBankroll: number;
  /** Average number of rebuys per run (0 when rebuy is off). */
  averageRebuys: number;
  /** Share of runs with at least one rebuy. */
  rebuyRunRate: number;
  /** Average points put on the table per run: first buy-in plus all rebuys. */
  averageTotalBuyIn: number;
  /** Average of (total buy-in − ending bankroll): how much a player is down overall. */
  averageNetLoss: number;
  /** Leave-time histogram, 10 equal buckets over [0, maxRounds]. */
  buckets: number[];
  /** Average points wagered per run. */
  averageWagered: number;
  /** All runs together: points won (+) or lost (−) per point wagered. */
  netPerPointWagered: number;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Repeat a single-seat experiment. Orchestration only: every round goes through
 * createTable + playAutoRound (the same dispatch channel as the live table).
 * Unexpected errors propagate to the caller instead of being counted as survival.
 */
export function runMonteCarlo(
  request: MonteCarloRequest,
  onProgress?: (percent: number) => void,
): MonteCarloResult {
  const { gameId, runs, maxRounds, bankroll, strategyId, seed } = request;
  const rebuy = Boolean(request.rebuy);
  if (request.rules !== undefined) registerRuleStrategy(request.rules, strategyId);
  let totalWagered = 0;
  const leaveRounds: number[] = [];
  const endingBankrolls: number[] = [];
  const totalBuyIns: number[] = [];
  const rebuyCounts: number[] = [];
  let bustCount = 0;
  let insufficientCount = 0;

  for (let run = 0; run < runs; run += 1) {
    const rng = seed == null ? Math.random : mulberry32((seed + run * 9973) >>> 0);
    let table = createTable(gameId, {
      seats: [
        {
          profile: { id: `mc-${run}`, name: "MC", bankroll },
          control: { kind: "auto", strategyId },
        },
        null,
        null,
        null,
        null,
      ],
    });

    while (table.round < maxRounds && table.seats[0]) {
      table = playAutoRound(table, strategyId, rng, { rebuy });
    }

    totalWagered += table.totalWagered;
    const seat = table.seats[0];
    if (seat) {
      endingBankrolls.push(seat.bankroll);
      totalBuyIns.push(seat.totalBuyIn);
      rebuyCounts.push(seat.buyIns - 1);
    } else {
      const record = table.busts[0];
      leaveRounds.push(record.roundsPlayed);
      endingBankrolls.push(record.bankroll);
      totalBuyIns.push(record.totalBuyIn);
      rebuyCounts.push(record.buyIns - 1);
      if (record.reason === "bankrupt") bustCount += 1;
      else insufficientCount += 1;
    }

    if (onProgress && run % 50 === 0) onProgress(Math.round((run / runs) * 100));
  }

  const sorted = [...leaveRounds].sort((a, b) => a - b);
  const buckets = Array(10).fill(0) as number[];
  for (const round of leaveRounds) {
    buckets[Math.min(9, Math.floor((round / maxRounds) * 10))] += 1;
  }

  return {
    runs,
    maxRounds,
    rebuy,
    bankruptcyRate: leaveRounds.length / runs,
    bustCount,
    insufficientCount,
    medianBustRound: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    survivorCount: runs - leaveRounds.length,
    averageEndingBankroll: average(endingBankrolls),
    averageRebuys: average(rebuyCounts),
    rebuyRunRate: rebuyCounts.filter((count) => count > 0).length / runs,
    averageTotalBuyIn: average(totalBuyIns),
    averageNetLoss: average(totalBuyIns.map((total, index) => total - endingBankrolls[index])),
    buckets,
    averageWagered: totalWagered / runs,
    netPerPointWagered:
      totalWagered > 0
        ? endingBankrolls.reduce((sum, value, index) => sum + value - totalBuyIns[index], 0) / totalWagered
        : 0,
  };
}

export interface LifetimeRequest {
  gameId: string;
  /** How many people to simulate. */
  people: number;
  /** Visits per person. */
  visits: number;
  /** Points brought on every visit. */
  bankroll: number;
  strategyId: string;
  plan: VisitPlan;
  /** Safety cap on one visit's rounds when the plan has no time limit. */
  maxRoundsPerVisit: number;
  seed?: number;
  rebuy?: boolean;
}

export interface LifetimeResult {
  people: number;
  visits: number;
  /** Share of all visits that ended up (net > 0). */
  winningVisitRate: number;
  /** Average net of a single visit. */
  averageVisitNet: number;
  /** Share of people whose lifetime total is above 0. */
  winningLifetimeRate: number;
  /** Average lifetime total over all visits. */
  averageLifetimeNet: number;
  /** Average points wagered per person over all visits. */
  averageLifetimeWagered: number;
  /** Average lifetime net divided by average lifetime wagered: the per-point edge seen. */
  netPerWagered: number;
  /** Visits by how they ended. */
  reasons: Record<LeaveReason | "cap", number>;
}

/**
 * Many people each going to the table `visits` times with the same plan. Orchestration only:
 * every round goes through createTable + playAutoRound, exactly like runMonteCarlo.
 */
export function runLifetimeExperiment(request: LifetimeRequest): LifetimeResult {
  const { gameId, people, visits, bankroll, strategyId, plan, maxRoundsPerVisit, seed } = request;
  const rebuy = Boolean(request.rebuy);
  const reasons: Record<LeaveReason | "cap", number> = {
    bankrupt: 0,
    insufficient_funds: 0,
    left: 0,
    stop_win: 0,
    stop_loss: 0,
    time_up: 0,
    switch_table: 0,
    cap: 0,
  };
  let winningVisits = 0;
  let visitNetSum = 0;
  let winningLifetimes = 0;
  let lifetimeNetSum = 0;
  let wageredSum = 0;

  for (let person = 0; person < people; person += 1) {
    const rng = seed == null ? Math.random : mulberry32((seed + person * 7919) >>> 0);
    let lifetimeNet = 0;
    for (let visit = 0; visit < visits; visit += 1) {
      let table = createTable(gameId, {
        seats: [
          {
            profile: { id: `life-${person}-${visit}`, personId: `life-${person}`, name: "MC", bankroll },
            control: { kind: "auto", strategyId },
            plan,
          },
          null,
          null,
          null,
          null,
        ],
      });
      while (table.round < maxRoundsPerVisit && table.seats[0]) {
        table = playAutoRound(table, strategyId, rng, { rebuy });
      }
      const seat = table.seats[0];
      const net = seat ? seat.bankroll - seat.totalBuyIn : table.busts[0].bankroll - table.busts[0].totalBuyIn;
      reasons[seat ? "cap" : table.busts[0].reason] += 1;
      if (net > 0) winningVisits += 1;
      visitNetSum += net;
      lifetimeNet += net;
      wageredSum += table.totalWagered;
    }
    if (lifetimeNet > 0) winningLifetimes += 1;
    lifetimeNetSum += lifetimeNet;
  }

  const totalVisits = people * visits;
  return {
    people,
    visits,
    winningVisitRate: winningVisits / totalVisits,
    averageVisitNet: visitNetSum / totalVisits,
    winningLifetimeRate: winningLifetimes / people,
    averageLifetimeNet: lifetimeNetSum / people,
    averageLifetimeWagered: wageredSum / people,
    netPerWagered: wageredSum ? lifetimeNetSum / wageredSum : 0,
    reasons,
  };
}
