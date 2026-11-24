export type RNG = () => number;
export type Phase = "idle" | "dealing" | "awaiting_bets" | "showdown" | "settled";
export type Outcome = "win" | "loss" | "none";

export interface PlayerProfile {
  id: string;
  name: string;
  /** What this person brings for this visit. */
  bankroll: number;
  /**
   * The same person across visits (the lifetime ledger groups by it). Defaults to `id`.
   * `id` names one seating, so a person who comes back gets a new `id` but keeps `personId`.
   */
  personId?: string;
}

/**
 * When a player plans to walk away during one visit. Every field is optional (owner decision
 * 2026-11-24: only the amount brought is required). The table carries the plan out between
 * rounds, the same way for human and auto seats.
 */
export interface VisitPlan {
  /** Leave once up this much for the visit (bankroll − everything put in). */
  stopWin?: number;
  /** Leave once down this much for the visit; no rebuy past this line. */
  stopLoss?: number;
  /** Leave after playing this many rounds in this visit ("out of time"). */
  maxRounds?: number;
}

export type SeatControl =
  | { kind: "auto"; strategyId: string }
  | { kind: "human" };

export interface Seat {
  playerId: string;
  personId: string;
  /** One trip to the casino. Moving to another table keeps it, so the trip stays one visit. */
  visitId: string;
  name: string;
  plan: VisitPlan;
  bankroll: number;
  initialBankroll: number;
  control: SeatControl;
  roundsPlayed: number;
  wins: number;
  winStreak: number;
  lossStreak: number;
  lastOutcome: Outcome;
  /** The bet this seat placed in its last settled round (null before the first). */
  lastAction: unknown | null;
  /** Bankroll after each settled round; history[0] is the first buy-in. Rebuys are listed separately. */
  history: number[];
  /** Number of buy-ins so far, the first one included. */
  buyIns: number;
  /** Everything this player has put on the table: first buy-in plus every rebuy. */
  totalBuyIn: number;
  rebuys: RebuyRecord[];
}

/** The same player putting more points on the table at the moment they would otherwise leave. */
export interface RebuyRecord {
  round: number;
  /** Rounds this player had played when rebuying; the chart draws the jump at this x. */
  roundsPlayed: number;
  /** Bankroll just before the rebuy. */
  before: number;
  amount: number;
}

/**
 * Why a player left the table:
 * - bankrupt: bankroll hit 0 at settlement and the player did not rebuy
 * - insufficient_funds: could not cover the worst-case loss of the bet they wanted to place
 * - left: left voluntarily (human seat)
 * - stop_win / stop_loss / time_up: their VisitPlan said so
 * - switch_table: took their chips to another table; the visit goes on there
 */
export type LeaveReason =
  | "bankrupt"
  | "insufficient_funds"
  | "left"
  | "stop_win"
  | "stop_loss"
  | "time_up"
  | "switch_table";

/**
 * What a player carries from one table to another within the same visit: everything that
 * describes the visit so far, so buy-ins, rounds, plan and streaks continue where they left off.
 * Built only by `switchTable` (lib/core/casino.ts) from the seat that just left.
 */
export interface SeatCarry {
  visitId: string;
  initialBankroll: number;
  totalBuyIn: number;
  buyIns: number;
  roundsPlayed: number;
  wins: number;
  /** Optional so older callers keep working; missing means 0. */
  winStreak?: number;
  lossStreak: number;
  lastOutcome: Outcome;
  lastAction?: unknown | null;
}

/** One seat's part in a settled round, as everyone at the table saw it. */
export interface PublicSeatResult {
  seatIndex: number;
  personId: string;
  name: string;
  /** The bet that was on the felt. */
  bet: unknown;
  /** Points actually won (+) or lost (−), after the bankroll cap. */
  delta: number;
  outcome: "win" | "loss" | "push";
}

/**
 * One settled round as anyone at the table could see it. This is the table's public record:
 * the road (庄/闲) and everything strategies may read about past rounds. It is written only
 * after the cards are turned over and never feeds the next deal.
 */
export interface RoundResult {
  round: number;
  /** Which dealer dealt this round (index into DEALERS). */
  dealerIndex: number;
  /** Dealer's net for the round (> 0: the dealer won overall). */
  dealerDelta: number;
  /** Seats that beat the dealer / lost to the dealer this round. */
  playerWins: number;
  playerLosses: number;
  /** Every seat that played, in seat order. */
  seats: PublicSeatResult[];
  /** What the game reveals once the cards are up (GameModule.publicRecord); null if it says nothing. */
  detail: unknown;
}

export type PlanExit = Extract<LeaveReason, "stop_win" | "stop_loss" | "time_up">;

export interface BustRecord {
  playerId: string;
  personId: string;
  visitId: string;
  name: string;
  round: number;
  reason: LeaveReason;
  /** Bankroll the player walked away with (0 when bankrupt). */
  bankroll: number;
  roundsPlayed: number;
  buyIns: number;
  totalBuyIn: number;
}

export interface Settlement {
  seatIndex: number;
  delta: number;
  outcome: "win" | "loss" | "push";
  label?: string;
}

export interface RoundContext {
  gameState: unknown;
  actions: (unknown | null)[];
  settlements: Settlement[] | null;
}

export interface TableState {
  gameId: string;
  phase: Phase;
  round: number;
  shuffleCount: number;
  dealerIndex: number;
  dealerProfit: number;
  playerNet: number;
  totalWagered: number;
  seats: (Seat | null)[];
  busts: BustRecord[];
  /**
   * The most recent settled rounds, newest last (at most ROAD_LOG_SIZE): the table's public
   * record. The lobby draws its road from it and strategies read it through `observe()`.
   */
  roadLog: RoundResult[];
  roundCtx: RoundContext | null;
}
