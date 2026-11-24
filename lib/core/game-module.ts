import type { ActionSpec } from "./actions.ts";
import type {
  BustRecord,
  Outcome,
  Phase,
  RNG,
  RoundResult,
  Settlement,
  Seat,
  VisitPlan,
} from "./types.ts";

export interface GameMeta {
  name: string;
  eyebrow: string;
  rulesText: string;
  educationNotes: string[];
}

export interface GameModule {
  readonly id: string;
  readonly meta: GameMeta;

  createRound(input: { seatIndexes: number[]; rng: RNG }): unknown;

  actionSpecFor(state: unknown, seatIndex: number, seat: Seat): ActionSpec | null;

  validate(state: unknown, seatIndex: number, action: unknown, seat: Seat): string | null;

  maxLoss(action: unknown): number;

  /** Worst-case loss of the smallest legal bet. A bankroll below this cannot play a round. */
  minStake?(): number;

  /** Smallest unit of points at this table: every stake and rebuy is a multiple of it. Default 1. */
  pointUnit?(): number;

  applyAction(state: unknown, seatIndex: number, action: unknown): unknown;

  settle(state: unknown, actions: (unknown | null)[]): Settlement[];

  totalWager(actions: (unknown | null)[]): number;

  viewOf(state: unknown, seatIndex: number | null, phase: Phase): unknown;

  /**
   * What everyone may know about a round once its cards are up (for niuniu: every hand and
   * its type). Stored in the table's public record (`RoundResult.detail`). Called only after
   * settlement, so it may read the whole state. Omit it and the record keeps only core facts.
   */
  publicRecord?(state: unknown, actions: (unknown | null)[], settlements: Settlement[]): unknown;

  /** The game-specific variables a strategy can read (bets, hand types…), for the editor. */
  observationCatalog?(): ObservationField[];
}

/**
 * Everything one seat can see when it is its turn to bet: the same as a person sitting there.
 * Built only by `observe()` (lib/core/observe.ts) from the public record, the face-down view
 * and the chips already on the felt. Never contains this round's cards, the seed or the deck.
 */
export interface Observation {
  gameId: string;
  /** The round being bet on (or the next one, between rounds). */
  round: number;
  shuffleCount: number;
  me: MyObservation;
  /** Every seat in seat order; null for an empty seat. My own seat is included (isMe). */
  seats: (SeatObservation | null)[];
  dealer: DealerObservation;
  /** Points wagered at this table so far. */
  totalWagered: number;
  /** Settled rounds, oldest first (at most ROAD_LOG_SIZE). Read-only. */
  history: readonly RoundResult[];
  /** People who left this table, newest first (at most OBSERVED_DEPARTURES). Read-only. */
  departures: readonly BustRecord[];
  /** The game's view for this seat; during bets every card is face down. */
  view: unknown;
  /** What this seat may do now (null between rounds). */
  spec: ActionSpec | null;
}

/** What anyone at the table can see about a seat: chips, buy-ins, streaks, bets on the felt. */
export interface SeatObservation {
  seatIndex: number;
  isMe: boolean;
  name: string;
  personId: string;
  bankroll: number;
  /** Chips bought at this table during this visit, first buy-in included. */
  totalBuyIn: number;
  buyIns: number;
  /** Up (+) or down (−) for this visit: bankroll − totalBuyIn. */
  visitNet: number;
  roundsPlayed: number;
  wins: number;
  winStreak: number;
  lossStreak: number;
  lastOutcome: Outcome;
  /** The bet placed in the seat's last settled round (null before its first). */
  lastBet: unknown | null;
  /** The bet already on the felt this round (null if this seat has not bet yet). */
  betThisRound: unknown | null;
}

/** My own seat: what others see, plus my private plan and my place in the betting order. */
export interface MyObservation extends SeatObservation {
  initialBankroll: number;
  plan: VisitPlan;
  /** How far the plan still is; null for a line that is not set. */
  planRemaining: {
    /** Points still to win before the stop-win line. */
    toStopWin: number | null;
    /** Points I can still lose before the stop-loss line. */
    toStopLoss: number | null;
    /** Rounds left before the round limit. */
    roundsLeft: number | null;
  };
  /** 1 = first to bet this round; seats bet in seat order. */
  betPosition: number;
  /** Seats that have already bet this round. */
  alreadyBet: number;
}

export interface DealerObservation {
  index: number;
  name: string;
  /** Rounds this dealer has dealt since taking over (settled rounds only). */
  roundsThisShift: number;
  /** Rounds this dealer will still deal, the current one included, before the scheduled change. */
  roundsLeftInShift: number;
  /** The dealer's run against the table: consecutive rounds the dealer won (or lost) overall. */
  streak: { outcome: "win" | "loss" | "none"; length: number };
  /** Dealer's total at this table (> 0: the dealer is up). */
  profit: number;
}

/** One variable a strategy can read, described for the strategy editor. */
export interface ObservationField {
  /**
   * Where it lives in the Observation. `[]` marks a list: `seats[].lossStreak` is the field
   * on each seat, `history[].dealerDelta` on each past round.
   */
  path: string;
  label: string;
  group: "me" | "dealer" | "seats" | "table" | "history" | "departures";
  type: "number" | "boolean" | "text" | "enum";
  /** For `enum`: the possible values with their labels. */
  values?: { value: string; label: string }[];
  unit?: "points" | "rounds" | "count" | "multiplier";
  /** True when the value can be null (e.g. no last bet yet, a plan line not set). */
  nullable?: boolean;
  description?: string;
}

/** A strategy acts only on its turn to bet, so `spec` is always there. */
export type StrategyInput = Observation & { spec: ActionSpec };

export interface StrategyModule {
  readonly id: string;
  readonly name: string;
  readonly short: string;
  readonly description: string;
  act(input: StrategyInput): unknown;
}
