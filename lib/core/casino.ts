import type { AnyAction } from "./actions.ts";
import { dispatch } from "./table.ts";
import type { RNG, RoundResult, TableState } from "./types.ts";

/**
 * A casino is several tables running side by side. Every table keeps its own books (dealer,
 * zero-sum, seats); this module only adds the rules that span tables:
 * - one person sits at one table at a time;
 * - moving to another table carries the chips and the visit along (it is still one visit).
 * Nothing here deals cards or settles a round.
 */

export interface SeatRef {
  tableIndex: number;
  seatIndex: number;
}

/** Where this person is sitting right now, or null. */
export function seatOf(tables: TableState[], personId: string): SeatRef | null {
  for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
    const seatIndex = tables[tableIndex].seats.findIndex((seat) => seat?.personId === personId);
    if (seatIndex >= 0) return { tableIndex, seatIndex };
  }
  return null;
}

function replaceTable(tables: TableState[], index: number, table: TableState) {
  return tables.map((item, itemIndex) => (itemIndex === index ? table : item));
}

/**
 * Seat someone at one table, refusing if they are already sitting at any table.
 * (`table/seat_player` itself only knows about its own table.)
 */
export function seatAt(
  tables: TableState[],
  tableIndex: number,
  action: Extract<AnyAction, { type: "table/seat_player" }>,
  rng: RNG,
): TableState[] {
  const personId = action.profile.personId ?? action.profile.id;
  const where = seatOf(tables, personId);
  if (where) {
    throw new Error(`${action.profile.name} is already seated at table ${where.tableIndex + 1}`);
  }
  return replaceTable(tables, tableIndex, dispatch(tables[tableIndex], action, rng));
}

/**
 * Take a seated player, with their chips, to an empty seat at another table. Both tables must
 * be between rounds. The first table records a `switch_table` leave; the second continues the
 * same visit (buy-ins, rounds, plan, streak). No points move between player and dealer, so both
 * tables' zero-sum books are unaffected.
 */
export function switchTable(
  tables: TableState[],
  from: SeatRef,
  to: SeatRef,
  rng: RNG,
  newSeatingId: string,
): TableState[] {
  if (from.tableIndex === to.tableIndex) throw new Error("Already at this table");
  const source = tables[from.tableIndex];
  const target = tables[to.tableIndex];
  if (!source || !target) throw new Error("Unknown table");
  if (source.phase !== "idle" || target.phase !== "idle") {
    throw new Error("Switching tables is only allowed between rounds at both tables");
  }
  const seat = source.seats[from.seatIndex];
  if (!seat) throw new Error(`Seat ${from.seatIndex} at table ${from.tableIndex + 1} is empty`);
  if (target.seats[to.seatIndex]) {
    throw new Error(`Seat ${to.seatIndex} at table ${to.tableIndex + 1} is taken`);
  }
  if (source.gameId !== target.gameId) {
    throw new Error("Chips can only move between tables of the same game for now");
  }

  const left = dispatch(source, { type: "table/leave", seatIndex: from.seatIndex, reason: "switch_table" }, rng);
  const seated = dispatch(
    target,
    {
      type: "table/seat_player",
      seatIndex: to.seatIndex,
      profile: { id: newSeatingId, personId: seat.personId, name: seat.name, bankroll: seat.bankroll },
      control: seat.control,
      plan: seat.plan,
      carry: {
        visitId: seat.visitId,
        initialBankroll: seat.initialBankroll,
        totalBuyIn: seat.totalBuyIn,
        buyIns: seat.buyIns,
        roundsPlayed: seat.roundsPlayed,
        wins: seat.wins,
        winStreak: seat.winStreak,
        lossStreak: seat.lossStreak,
        lastOutcome: seat.lastOutcome,
        lastAction: seat.lastAction,
      },
    },
    rng,
  );
  return replaceTable(replaceTable(tables, from.tableIndex, left), to.tableIndex, seated);
}

/** How a round looked from the rail. */
export type RoadMark = "dealer_sweep" | "dealer" | "players" | "players_sweep" | "even";

/**
 * 庄/闲 for one round: the dealer won overall (庄) or the players did (闲). A sweep means
 * every seat that played lost (通杀) or won (通赔).
 */
export function roadMark(result: RoundResult): RoadMark {
  const played = result.playerWins + result.playerLosses;
  if (played > 0 && result.playerWins === 0 && result.dealerDelta > 0) return "dealer_sweep";
  if (played > 0 && result.playerLosses === 0 && result.dealerDelta < 0) return "players_sweep";
  if (result.dealerDelta > 0) return "dealer";
  if (result.dealerDelta < 0) return "players";
  return "even";
}
