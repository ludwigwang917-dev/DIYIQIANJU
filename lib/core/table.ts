import type { AnyAction, TableAction } from "./actions.ts";
import { getGame } from "./registry.ts";
import type {
  LeaveReason,
  PlayerProfile,
  PublicSeatResult,
  RNG,
  Seat,
  SeatControl,
  SeatCarry,
  TableState,
  VisitPlan,
} from "./types.ts";
import { planBlocksRebuy, planExits, validatePlan } from "./visit.ts";

export const DEALERS = ["林岚", "周玥", "方哲", "季安", "沈真", "许澄"];

/** A single rebuy may not exceed this multiple of the player's first buy-in. */
export const REBUY_MAX_MULTIPLE = 10;

/** Worst-case loss of the smallest legal bet in this game (1 if the game does not say). */
export function minStake(gameId: string): number {
  return getGame(gameId).minStake?.() ?? 1;
}

/** Smallest unit of points in this game (1 if the game does not say). */
export function pointUnit(gameId: string): number {
  return getGame(gameId).pointUnit?.() ?? 1;
}

/** Largest amount one rebuy may bring for this seat. */
export function maxRebuyAmount(seat: Seat): number {
  return REBUY_MAX_MULTIPLE * seat.initialBankroll;
}

/**
 * Seats that went bust (bankroll 0) and have not yet decided between rebuying and leaving.
 * The next round cannot start until each of them has decided.
 */
export function bustedSeats(table: TableState): number[] {
  return table.seats.flatMap((seat, index) => (seat && seat.bankroll <= 0 ? [index] : []));
}

function participatingIndexes(table: TableState): number[] {
  return table.seats.flatMap((seat, index) => (seat && seat.bankroll > 0 ? [index] : []));
}

function cloneSeats(seats: (Seat | null)[]): (Seat | null)[] {
  return seats.map((seat) =>
    seat
      ? {
          ...seat,
          history: [...seat.history],
          rebuys: seat.rebuys.map((item) => ({ ...item })),
          control: { ...seat.control },
          plan: { ...seat.plan },
        }
      : null,
  );
}

function newSeat(
  profile: PlayerProfile,
  control: SeatControl,
  plan: VisitPlan = {},
  carry?: SeatCarry,
): Seat {
  return {
    playerId: profile.id,
    personId: profile.personId ?? profile.id,
    visitId: carry?.visitId ?? profile.id,
    name: profile.name,
    plan: { ...plan },
    bankroll: profile.bankroll,
    initialBankroll: carry?.initialBankroll ?? profile.bankroll,
    control: { ...control },
    roundsPlayed: carry?.roundsPlayed ?? 0,
    wins: carry?.wins ?? 0,
    winStreak: carry?.winStreak ?? 0,
    lossStreak: carry?.lossStreak ?? 0,
    lastOutcome: carry?.lastOutcome ?? "none",
    lastAction: carry?.lastAction ?? null,
    history: [profile.bankroll],
    buyIns: carry?.buyIns ?? 1,
    totalBuyIn: carry?.totalBuyIn ?? profile.bankroll,
    rebuys: [],
  };
}

/**
 * How many settled rounds a table keeps in its public record. The lobby draws only the most
 * recent ones as its road; strategies can look back over all of them.
 */
export const ROAD_LOG_SIZE = 200;

/** A dealer hands over to the next after every this many rounds (`round % DEALER_SHIFT === 0`). */
export const DEALER_SHIFT = 30;

export function createTable(
  gameId: string,
  opts: {
    seats: ({ profile: PlayerProfile; control: SeatControl; plan?: VisitPlan } | null)[];
    dealerIndex?: number;
  },
): TableState {
  getGame(gameId);
  for (const entry of opts.seats) {
    const reason = entry?.plan ? validatePlan(entry.plan) : null;
    if (reason) throw new Error(reason);
  }
  return {
    gameId,
    phase: "idle",
    round: 0,
    shuffleCount: 0,
    dealerIndex: opts.dealerIndex ?? 0,
    dealerProfit: 0,
    playerNet: 0,
    totalWagered: 0,
    seats: opts.seats.map((entry) =>
      entry ? newSeat(entry.profile, entry.control, entry.plan) : null,
    ),
    busts: [],
    roadLog: [],
    roundCtx: null,
  };
}

export function pendingSeats(table: TableState): number[] {
  if (table.phase !== "awaiting_bets" || !table.roundCtx) return [];
  return participatingIndexes(table).filter(
    (seatIndex) => table.roundCtx!.actions[seatIndex] == null,
  );
}

/**
 * Whose turn it is to bet: seats bet one at a time in seat order (owner decision 2026-11-24,
 * because a seat may look at the chips already on the felt). Null when nobody is pending.
 */
export function nextToAct(table: TableState): number | null {
  return pendingSeats(table)[0] ?? null;
}

export function legalTableActions(table: TableState): TableAction[] {
  if (table.phase === "idle") {
    const busted = bustedSeats(table);
    const actions: TableAction[] = [{ type: "table/rotate_dealer" }];
    if (busted.length === 0 && participatingIndexes(table).length > 0) {
      actions.push({ type: "table/start_round" });
    }
    // A busted seat leaves as bankrupt, or rebuys (amount is the player's choice, so not enumerated).
    for (const seatIndex of busted) {
      actions.push({ type: "table/leave", seatIndex, reason: "bankrupt" });
    }
    table.seats.forEach((seat, seatIndex) => {
      if (seat && seat.bankroll > 0) {
        actions.push({
          type: "table/set_control",
          seatIndex,
          control: seat.control,
        });
      }
    });
    return actions;
  }
  if (
    table.phase === "dealing" ||
    table.phase === "showdown" ||
    table.phase === "settled" ||
    (table.phase === "awaiting_bets" && pendingSeats(table).length === 0)
  ) {
    return [{ type: "table/advance" }];
  }
  if (table.phase === "awaiting_bets") {
    return pendingSeats(table).map((seatIndex): TableAction => ({
      type: "table/leave",
      seatIndex,
      reason: "left",
    }));
  }
  return [];
}

export function viewForSeat(table: TableState, seatIndex: number | null): unknown {
  if (!table.roundCtx) return null;
  const mod = getGame(table.gameId);
  return mod.viewOf(table.roundCtx.gameState, seatIndex, table.phase);
}

export function assertZeroSum(table: TableState): void {
  const sum = table.dealerProfit + table.playerNet;
  if (Math.abs(sum) > 1e-9) {
    throw new Error(`Zero-sum invariant broken: dealerProfit + playerNet = ${sum}`);
  }
}

function advance(table: TableState): TableState {
  const mod = getGame(table.gameId);

  if (table.phase === "dealing") {
    return { ...table, phase: "awaiting_bets" };
  }

  if (table.phase === "awaiting_bets") {
    if (pendingSeats(table).length > 0) {
      throw new Error("Cannot advance: not all participating seats have submitted actions");
    }
    return { ...table, phase: "showdown" };
  }

  if (table.phase === "showdown") {
    if (!table.roundCtx) throw new Error("Missing round context at showdown");
    const settlements = mod.settle(table.roundCtx.gameState, table.roundCtx.actions);
    return {
      ...table,
      phase: "settled",
      roundCtx: { ...table.roundCtx, settlements },
    };
  }

  if (table.phase === "settled") {
    if (!table.roundCtx?.settlements) throw new Error("Missing settlements at settled phase");
    const seats = cloneSeats(table.seats);
    const busts = [...table.busts];
    let dealerDelta = 0;
    let playerDelta = 0;
    let playerWins = 0;
    let playerLosses = 0;
    const publicSeats: PublicSeatResult[] = [];

    for (const settlement of table.roundCtx.settlements) {
      const seat = seats[settlement.seatIndex];
      if (!seat) continue;
      const bet = table.roundCtx.actions[settlement.seatIndex] ?? null;
      const effectiveDelta =
        settlement.delta < 0
          ? Math.max(settlement.delta, -seat.bankroll)
          : settlement.delta;
      const bankroll = seat.bankroll + effectiveDelta;
      const outcome =
        settlement.outcome === "push"
          ? seat.lastOutcome
          : settlement.outcome;
      const updated: Seat = {
        ...seat,
        bankroll,
        roundsPlayed: seat.roundsPlayed + 1,
        wins: seat.wins + (settlement.outcome === "win" ? 1 : 0),
        winStreak:
          settlement.outcome === "loss"
            ? 0
            : settlement.outcome === "win"
              ? seat.winStreak + 1
              : seat.winStreak,
        lossStreak:
          settlement.outcome === "win"
            ? 0
            : settlement.outcome === "loss"
              ? seat.lossStreak + 1
              : seat.lossStreak,
        lastOutcome: settlement.outcome === "push" ? seat.lastOutcome : outcome,
        lastAction: bet,
        history: [...seat.history, bankroll],
      };
      dealerDelta -= effectiveDelta;
      playerDelta += effectiveDelta;
      if (effectiveDelta > 0) playerWins += 1;
      else if (effectiveDelta < 0) playerLosses += 1;
      publicSeats.push({
        seatIndex: settlement.seatIndex,
        personId: seat.personId,
        name: seat.name,
        bet,
        delta: effectiveDelta,
        outcome: settlement.outcome,
      });
      // A seat that hits 0 stays seated: it must rebuy or leave (as bankrupt) before the next round.
      seats[settlement.seatIndex] = updated;
    }

    const wagered = mod.totalWager(table.roundCtx.actions);
    let dealerIndex = table.dealerIndex;
    if (table.round % DEALER_SHIFT === 0) {
      dealerIndex = (dealerIndex + 1) % DEALERS.length;
    }

    return {
      ...table,
      phase: "idle",
      dealerIndex,
      dealerProfit: table.dealerProfit + dealerDelta,
      playerNet: table.playerNet + playerDelta,
      totalWagered: table.totalWagered + wagered,
      seats,
      busts,
      // The public record shows only what everyone saw once the cards were up. It never
      // feeds the next deal; strategies read it through observe().
      roadLog: [
        ...(table.roadLog ?? []),
        {
          round: table.round,
          dealerIndex: table.dealerIndex,
          dealerDelta,
          playerWins,
          playerLosses,
          seats: publicSeats.sort((a, b) => a.seatIndex - b.seatIndex),
          detail:
            mod.publicRecord?.(
              table.roundCtx.gameState,
              table.roundCtx.actions,
              table.roundCtx.settlements,
            ) ?? null,
        },
      ].slice(-ROAD_LOG_SIZE),
      roundCtx: null,
    };
  }

  throw new Error(`Cannot advance from phase ${table.phase}`);
}

function startRound(table: TableState, rng: RNG): TableState {
  if (table.phase !== "idle") {
    throw new Error("start_round is only allowed in idle phase");
  }
  const busted = bustedSeats(table);
  if (busted.length > 0) {
    throw new Error(`Seat ${busted[0]} is bust: it must rebuy or leave before the next round`);
  }
  const seatIndexes = participatingIndexes(table);
  if (seatIndexes.length === 0) {
    throw new Error("Cannot start round with no seated players");
  }
  const mod = getGame(table.gameId);
  const gameState = mod.createRound({ seatIndexes, rng });
  const actions: (unknown | null)[] = Array(table.seats.length).fill(null);
  const next: TableState = {
    ...table,
    phase: "dealing",
    round: table.round + 1,
    shuffleCount: table.shuffleCount + 1,
    roundCtx: { gameState, actions, settlements: null },
  };
  return advance(next);
}

function applyGameAction(table: TableState, seatIndex: number, action: unknown): TableState {
  if (table.phase !== "awaiting_bets") {
    throw new Error("game/action is only allowed in awaiting_bets phase");
  }
  if (!table.roundCtx) throw new Error("Missing round context");
  const seat = table.seats[seatIndex];
  if (!seat) throw new Error(`Seat ${seatIndex} is empty`);
  if (!participatingIndexes(table).includes(seatIndex)) {
    throw new Error(`Seat ${seatIndex} is not participating in this round`);
  }
  if (table.roundCtx.actions[seatIndex] != null) {
    throw new Error(`Seat ${seatIndex} has already submitted an action`);
  }
  const turn = nextToAct(table);
  if (turn !== seatIndex) {
    throw new Error(`Seat ${seatIndex} must wait: seats bet in seat order and seat ${turn} is next`);
  }

  const mod = getGame(table.gameId);
  const reason = mod.validate(table.roundCtx.gameState, seatIndex, action, seat);
  if (reason) throw new Error(reason);

  const loss = mod.maxLoss(action);
  if (loss > seat.bankroll) {
    throw new Error(
      `maxLoss ${loss} exceeds bankroll ${seat.bankroll} for seat ${seatIndex}`,
    );
  }

  const gameState = mod.applyAction(table.roundCtx.gameState, seatIndex, action);
  const actions = [...table.roundCtx.actions];
  actions[seatIndex] = action;

  return {
    ...table,
    roundCtx: {
      ...table.roundCtx,
      gameState,
      actions,
    },
  };
}

/**
 * A seat leaves the table keeping whatever bankroll it has left. Allowed while idle,
 * or during awaiting_bets for a seat that has not bet yet (its hand is simply not settled).
 * Leaving moves no money, so the zero-sum ledger is unaffected.
 */
function leaveSeat(
  table: TableState,
  seatIndex: number,
  reason: LeaveReason,
): TableState {
  if (table.phase !== "idle" && table.phase !== "awaiting_bets") {
    throw new Error("leave is only allowed in idle or awaiting_bets phase");
  }
  const seat = table.seats[seatIndex];
  if (!seat) throw new Error(`Seat ${seatIndex} is empty`);
  if ((reason === "bankrupt") !== seat.bankroll <= 0) {
    throw new Error(
      reason === "bankrupt"
        ? `Seat ${seatIndex} still has ${seat.bankroll} and cannot leave as bankrupt`
        : `Seat ${seatIndex} is bust and can only leave as bankrupt`,
    );
  }
  if (
    (reason === "stop_win" || reason === "stop_loss" || reason === "time_up") &&
    !planExits(seat).includes(reason)
  ) {
    throw new Error(`Seat ${seatIndex} has not reached its ${reason} plan and cannot leave for it`);
  }
  if (reason === "switch_table" && table.phase !== "idle") {
    throw new Error("Switching tables is only allowed between rounds");
  }
  if (table.phase === "awaiting_bets" && table.roundCtx?.actions[seatIndex] != null) {
    throw new Error(`Seat ${seatIndex} has already bet this round and cannot leave until it settles`);
  }
  const seats = cloneSeats(table.seats);
  seats[seatIndex] = null;
  return {
    ...table,
    seats,
    busts: [
      {
        playerId: seat.playerId,
        personId: seat.personId,
        visitId: seat.visitId,
        name: seat.name,
        round: table.round,
        reason,
        bankroll: seat.bankroll,
        roundsPlayed: seat.roundsPlayed,
        buyIns: seat.buyIns,
        totalBuyIn: seat.totalBuyIn,
      },
      ...table.busts,
    ],
  };
}

/**
 * The same player buys in again instead of leaving. Rebuying brings outside points onto the
 * table; it is not a transfer with the dealer, so the zero-sum ledger is unaffected.
 */
function rebuySeat(
  table: TableState,
  seatIndex: number,
  amount: number,
  intended: unknown,
): TableState {
  if (table.phase !== "idle" && table.phase !== "awaiting_bets") {
    throw new Error("rebuy is only allowed in idle or awaiting_bets phase");
  }
  const seat = table.seats[seatIndex];
  if (!seat) throw new Error(`Seat ${seatIndex} is empty`);
  if (table.phase === "awaiting_bets" && table.roundCtx?.actions[seatIndex] != null) {
    throw new Error(`Seat ${seatIndex} has already bet this round`);
  }
  const blocked = planBlocksRebuy(seat);
  if (blocked) throw new Error(`Seat ${seatIndex} cannot rebuy: ${blocked}`);

  const mod = getGame(table.gameId);
  const floor = minStake(table.gameId);
  let required: number;
  if (seat.bankroll < floor) {
    required = floor;
  } else if (intended !== undefined) {
    if (table.phase !== "awaiting_bets" || !table.roundCtx) {
      throw new Error("A rebuy for an intended bet is only allowed while bets are open");
    }
    const reason = mod.validate(table.roundCtx.gameState, seatIndex, intended, seat);
    if (reason) throw new Error(reason);
    const loss = mod.maxLoss(intended);
    if (loss <= seat.bankroll) {
      throw new Error(`Seat ${seatIndex} can already cover this bet; no rebuy needed`);
    }
    required = loss;
  } else {
    throw new Error(
      `Seat ${seatIndex} can still play; a rebuy is only allowed when it cannot afford its next bet`,
    );
  }

  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error("Rebuy amount must be a positive integer");
  }
  const unit = pointUnit(table.gameId);
  if (amount % unit !== 0) {
    throw new Error(`Rebuy amount must be a multiple of ${unit}`);
  }
  if (amount > maxRebuyAmount(seat)) {
    throw new Error(`Rebuy amount ${amount} exceeds the limit ${maxRebuyAmount(seat)}`);
  }
  if (seat.bankroll + amount < required) {
    throw new Error(`Rebuy amount ${amount} still leaves the bankroll below ${required}`);
  }

  const seats = cloneSeats(table.seats);
  seats[seatIndex] = {
    ...seat,
    bankroll: seat.bankroll + amount,
    buyIns: seat.buyIns + 1,
    totalBuyIn: seat.totalBuyIn + amount,
    rebuys: [
      ...seat.rebuys,
      { round: table.round, roundsPlayed: seat.roundsPlayed, before: seat.bankroll, amount },
    ],
  };
  return { ...table, seats };
}

export function dispatch(table: TableState, action: AnyAction, rng: RNG): TableState {
  switch (action.type) {
    case "table/start_round":
      return startRound(table, rng);
    case "table/advance":
      return advance(table);
    case "table/rotate_dealer": {
      if (table.phase !== "idle") {
        throw new Error("rotate_dealer is only allowed in idle phase");
      }
      return {
        ...table,
        dealerIndex: (table.dealerIndex + 1) % DEALERS.length,
      };
    }
    case "table/leave":
      return leaveSeat(table, action.seatIndex, action.reason);
    case "table/rebuy":
      return rebuySeat(table, action.seatIndex, action.amount, action.intended);
    case "table/seat_player": {
      if (table.phase !== "idle") {
        throw new Error("seat_player is only allowed in idle phase");
      }
      const { seatIndex, profile, control, plan, carry } = action;
      if (seatIndex < 0 || seatIndex >= table.seats.length) {
        throw new Error(`Invalid seat index ${seatIndex}`);
      }
      if (table.seats[seatIndex]) {
        throw new Error(`Seat ${seatIndex} is taken: its player must leave first`);
      }
      const personId = profile.personId ?? profile.id;
      if (table.seats.some((seat) => seat?.personId === personId)) {
        throw new Error(`${profile.name} is already seated at this table`);
      }
      const unit = pointUnit(table.gameId);
      if (!Number.isInteger(profile.bankroll) || profile.bankroll % unit !== 0) {
        throw new Error(`The amount brought must be a multiple of ${unit}`);
      }
      if (profile.bankroll < minStake(table.gameId)) {
        throw new Error(`The amount brought must cover the minimum stake ${minStake(table.gameId)}`);
      }
      const planError = plan ? validatePlan(plan) : null;
      if (planError) throw new Error(planError);
      if (carry) {
        const counts = [carry.initialBankroll, carry.totalBuyIn, carry.buyIns];
        if (counts.some((value) => !Number.isInteger(value) || value < 1)) {
          throw new Error("A carried visit needs positive buy-in figures");
        }
        const tallies = [carry.roundsPlayed, carry.wins, carry.lossStreak, carry.winStreak ?? 0];
        if (!tallies.every((v) => Number.isInteger(v) && v >= 0)) {
          throw new Error("A carried visit needs non-negative round counts");
        }
      }
      const seats = cloneSeats(table.seats);
      seats[seatIndex] = newSeat(profile, control, plan, carry);
      return { ...table, seats };
    }
    case "table/set_control": {
      if (table.phase !== "idle") {
        throw new Error("set_control is only allowed in idle phase");
      }
      const seat = table.seats[action.seatIndex];
      if (!seat) throw new Error(`Seat ${action.seatIndex} is empty`);
      const seats = cloneSeats(table.seats);
      seats[action.seatIndex] = { ...seat, control: { ...action.control } };
      return { ...table, seats };
    }
    case "game/action":
      return applyGameAction(table, action.seatIndex, action.action);
    default: {
      const exhaustive: never = action;
      throw new Error(`Unknown action: ${JSON.stringify(exhaustive)}`);
    }
  }
}
