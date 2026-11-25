import { getGame, getStrategies } from "./registry.ts";
import {
  bustedSeats,
  dispatch,
  maxRebuyAmount,
  minStake,
  nextToAct,
  pendingSeats,
} from "./table.ts";
import { observe } from "./observe.ts";
import type { StrategyInput, StrategyModule } from "./game-module.ts";
import type { RNG, Seat, TableState } from "./types.ts";
import { planBlocksRebuy, planExit } from "./visit.ts";

export interface AutoPlayOptions {
  /** Let auto seats randomly rebuy when they would otherwise leave (see AUTO_REBUY). */
  rebuy?: boolean;
  /**
   * Called each time a strategy decides a bet, with exactly what it saw. For display only
   * (e.g. showing on the table why a custom strategy bet what it bet); it cannot change the bet.
   */
  onDecide?: (event: {
    table: TableState;
    seatIndex: number;
    strategy: StrategyModule;
    input: StrategyInput;
    action: unknown;
  }) => void;
}

/**
 * How an auto-controlled player decides to rebuy (2026-11-24 owner decision, P-7):
 * each time they would leave, rebuy with this probability, bringing a random 50%–150%
 * of their first buy-in (rounded to 10), at most `maxRebuys` times.
 * All randomness comes from the table RNG, so a seeded run replays exactly.
 */
export const AUTO_REBUY = {
  probability: 0.5,
  minShare: 0.5,
  maxShare: 1.5,
  roundTo: 10,
  maxRebuys: 5,
} as const;

/**
 * Decide whether an auto seat rebuys and for how much. `required` is the bankroll the seat
 * needs after rebuying. Returns null when the player leaves instead.
 */
function autoRebuyAmount(seat: Seat, required: number, rng: RNG): number | null {
  if (seat.buyIns - 1 >= AUTO_REBUY.maxRebuys) return null;
  // Past the stop-loss or out of time: the plan says go home, not dig deeper.
  if (planBlocksRebuy(seat)) return null;
  if (rng() >= AUTO_REBUY.probability) return null;
  const { minShare, maxShare, roundTo } = AUTO_REBUY;
  const share = minShare + rng() * (maxShare - minShare);
  let amount = Math.max(roundTo, Math.round((seat.initialBankroll * share) / roundTo) * roundTo);
  const shortfall = required - seat.bankroll;
  if (amount < shortfall) amount = Math.ceil(shortfall / roundTo) * roundTo;
  if (amount > maxRebuyAmount(seat)) return null;
  return amount;
}

function isAutoSeat(seat: Seat, strategyOverride?: string) {
  return Boolean(strategyOverride) || seat.control.kind === "auto";
}

/**
 * Let the strategy of one pending seat act through the unified dispatch channel.
 * If the bet the strategy wants could lose more than the seat's bankroll, the player
 * either rebuys (only with `options.rebuy`, decided by AUTO_REBUY) or leaves the table
 * (reason "insufficient_funds").
 *
 * `strategyOverride` forces a strategy regardless of the seat's control (used by
 * Monte Carlo / playAutoRound); without it only seats under auto control act.
 */
export function actForSeat(
  table: TableState,
  seatIndex: number,
  rng: RNG,
  strategyOverride?: string,
  options: AutoPlayOptions = {},
): TableState {
  const seat = table.seats[seatIndex];
  if (!seat || !table.roundCtx) return table;
  if (!isAutoSeat(seat, strategyOverride)) return table;

  const mod = getGame(table.gameId);
  const strategies = getStrategies(table.gameId);
  const strategyId =
    strategyOverride ?? (seat.control.kind === "auto" ? seat.control.strategyId : undefined);
  const strategy = strategies.find((item) => item.id === strategyId) ?? strategies[0];

  // The strategy sees only what a person in this seat would: observe() is its whole input.
  const decide = (current: TableState) => {
    const observation = observe(current, seatIndex);
    if (!observation.spec) return null;
    const check = (action: unknown) =>
      mod.validate(current.roundCtx!.gameState, seatIndex, action, current.seats[seatIndex]!);
    const input = { ...observation, spec: observation.spec, check };
    const action = strategy.act(input);
    options.onDecide?.({ table: current, seatIndex, strategy, input, action });
    return action;
  };

  const leave = (current: TableState) =>
    dispatch(current, { type: "table/leave", seatIndex, reason: "insufficient_funds" }, rng);

  let current = table;
  let action = decide(current);
  if (action == null) return table;

  if (mod.maxLoss(action) > seat.bankroll) {
    const required = Math.max(mod.maxLoss(action), minStake(table.gameId));
    const amount = options.rebuy ? autoRebuyAmount(seat, required, rng) : null;
    if (amount == null) return leave(current);
    current = dispatch(
      current,
      { type: "table/rebuy", seatIndex, amount, intended: action },
      rng,
    );
    // The strategy sees its new bankroll; if it now wants more than it holds, it leaves.
    action = decide(current);
    if (action == null) return current;
    if (mod.maxLoss(action) > current.seats[seatIndex]!.bankroll) return leave(current);
  }
  return dispatch(current, { type: "game/action", seatIndex, action }, rng);
}

/**
 * Between rounds, every bust auto seat decides: rebuy (only with `options.rebuy`) or leave
 * as bankrupt. Human seats are left for the person to decide.
 */
export function resolveBustedSeats(
  table: TableState,
  rng: RNG,
  options: AutoPlayOptions = {},
  strategyOverride?: string,
): TableState {
  if (table.phase !== "idle") return table;
  let current = table;
  for (const seatIndex of bustedSeats(current)) {
    const seat = current.seats[seatIndex]!;
    if (!isAutoSeat(seat, strategyOverride)) continue;
    const amount = options.rebuy ? autoRebuyAmount(seat, minStake(current.gameId), rng) : null;
    current =
      amount == null
        ? dispatch(current, { type: "table/leave", seatIndex, reason: "bankrupt" }, rng)
        : dispatch(current, { type: "table/rebuy", seatIndex, amount }, rng);
  }
  return current;
}

/**
 * Between rounds, every seat whose VisitPlan says "go now" (stop-win, stop-loss, out of
 * rounds) leaves through table/leave. Applies to human and auto seats alike: a plan is a
 * commitment made when sitting down, carried out by the table. Seats without a plan stay.
 */
export function applyVisitPlans(table: TableState, rng: RNG): TableState {
  if (table.phase !== "idle") return table;
  let current = table;
  current.seats.forEach((seat, seatIndex) => {
    const reason = seat ? planExit(seat) : null;
    if (reason) current = dispatch(current, { type: "table/leave", seatIndex, reason }, rng);
  });
  return current;
}

/**
 * Let auto-controlled seats act in seat order, stopping at the first human seat still to bet
 * (call it again after that person bets). Seats after a human wait their turn.
 */
export function fillAutoSeats(
  table: TableState,
  rng: RNG,
  options: AutoPlayOptions = {},
): TableState {
  // Seats bet in seat order: auto seats act until the next seat in line is a human's.
  let current = table;
  for (let guard = 0; guard <= current.seats.length; guard += 1) {
    const seatIndex = nextToAct(current);
    if (seatIndex == null || current.seats[seatIndex]?.control.kind !== "auto") break;
    const next = actForSeat(current, seatIndex, rng, undefined, options);
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Drive one full round for all-auto seats via the unified dispatch channel, then let bust
 * seats rebuy or leave so the table is ready for the next round.
 */
export function playAutoRound(
  table: TableState,
  strategyId: string,
  rng: RNG,
  options: AutoPlayOptions = {},
): TableState {
  let current = resolveBustedSeats(table, rng, options, strategyId);
  current = dispatch(current, { type: "table/start_round" }, rng);

  for (let guard = 0; guard < 40; guard += 1) {
    if (current.phase === "idle") {
      return applyVisitPlans(resolveBustedSeats(current, rng, options, strategyId), rng);
    }

    if (current.phase === "awaiting_bets") {
      for (const seatIndex of pendingSeats(current)) {
        current = actForSeat(current, seatIndex, rng, strategyId, options);
      }
      if (pendingSeats(current).length > 0) {
        throw new Error("Auto round stalled with pending seats");
      }
      current = dispatch(current, { type: "table/advance" }, rng);
      continue;
    }

    current = dispatch(current, { type: "table/advance" }, rng);
  }

  throw new Error("Auto round exceeded advance guard");
}

export function collectRoundDeltas(
  initial: TableState,
  strategyId: string,
  rounds: number,
  rng: RNG,
): number[] {
  const deltas: number[] = [];
  let table = initial;
  for (let round = 0; round < rounds; round += 1) {
    if (!table.seats.some(Boolean)) break;
    const beforeNet = table.playerNet;
    table = playAutoRound(table, strategyId, rng);
    deltas.push(table.playerNet - beforeNet);
  }
  return deltas;
}
