import type { PlanExit, Seat, VisitPlan } from "./types.ts";

/**
 * One visit = one seating. These helpers read a seat's VisitPlan; they never move money.
 * The table layer uses them to validate plan exits and refuse rebuys past the plan,
 * and auto-play uses them to carry plans out between rounds.
 */

/** Up (+) or down (−) for this visit: bankroll minus everything brought in, rebuys included. */
export function visitNet(seat: Seat): number {
  return seat.bankroll - seat.totalBuyIn;
}

/** Every plan condition this seat currently meets, in priority order. */
export function planExits(seat: Seat): PlanExit[] {
  if (seat.bankroll <= 0) return [];
  const { stopWin, stopLoss, maxRounds } = seat.plan;
  const net = visitNet(seat);
  const exits: PlanExit[] = [];
  if (stopWin != null && net >= stopWin) exits.push("stop_win");
  if (stopLoss != null && -net >= stopLoss) exits.push("stop_loss");
  if (maxRounds != null && seat.roundsPlayed >= maxRounds) exits.push("time_up");
  return exits;
}

/** The plan exit to take now, or null to keep playing. */
export function planExit(seat: Seat): PlanExit | null {
  return planExits(seat)[0] ?? null;
}

/** Why the plan rules out a rebuy right now (null when it does not). */
export function planBlocksRebuy(seat: Seat): string | null {
  const { stopLoss, maxRounds } = seat.plan;
  if (stopLoss != null && -visitNet(seat) >= stopLoss) {
    return `already down ${-visitNet(seat)}, at or past the stop-loss of ${stopLoss}`;
  }
  if (maxRounds != null && seat.roundsPlayed >= maxRounds) {
    return `already played ${seat.roundsPlayed} of the planned ${maxRounds} rounds`;
  }
  return null;
}

/** A plan field must be a positive integer when present. Returns the reason it is not valid. */
export function validatePlan(plan: VisitPlan): string | null {
  for (const key of ["stopWin", "stopLoss", "maxRounds"] as const) {
    const value = plan[key];
    if (value == null) continue;
    if (!Number.isInteger(value) || value < 1) return `${key} must be a positive integer`;
  }
  return null;
}
