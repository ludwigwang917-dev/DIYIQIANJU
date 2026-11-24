import type { LeaveReason, TableState } from "./types.ts";

/**
 * Lifetime ledger: every visit of every person (human or auto) across all tables, read
 * straight from the tables' own records. A visit may span several tables (switching tables
 * keeps the visit); it ends with any leave other than `switch_table`. A person still seated
 * has one visit in progress. Nothing here moves money or recomputes a settlement.
 */

export interface VisitSummary {
  visitId: string;
  /** Everything brought to the tables this visit: first buy-in plus rebuys. */
  buyIn: number;
  /** What they walked away with (or hold now, for the visit in progress). */
  cashOut: number;
  /** cashOut − buyIn */
  net: number;
  rounds: number;
  buyIns: number;
  /** null while the visit is still in progress. */
  reason: LeaveReason | null;
  /** Table round when the visit ended (or the current round while in progress). */
  endRound: number;
  /** Tables sat at during this visit, in order (indexes into the tables passed in). */
  tables: number[];
}

export interface PersonLedger {
  personId: string;
  name: string;
  /** Oldest first. */
  visits: VisitSummary[];
  /** Seat index while seated now, else null. */
  seatIndex: number | null;
  /** Table index while seated now, else null. */
  tableIndex: number | null;
  finishedVisits: number;
  /** Finished visits that ended up (net > 0). */
  winningVisits: number;
  /** Sum of every visit's net, the one in progress included. */
  lifetimeNet: number;
  lifetimeBuyIn: number;
  lifetimeRounds: number;
}

interface Stint {
  personId: string;
  name: string;
  visitId: string;
  tableIndex: number;
  seatIndex: number | null;
  /** Order within the casino: table round, then table index. */
  order: [number, number];
  buyIn: number;
  cashOut: number;
  rounds: number;
  buyIns: number;
  /** null while still seated. */
  reason: LeaveReason | null;
}

/**
 * One ledger per person, in the order they first appeared. Pass one table or all tables of a
 * casino. Because a carried seat continues the visit's running totals, a visit's figures are
 * those of its last stint.
 */
export function lifetimeLedgers(input: TableState | TableState[]): PersonLedger[] {
  const tables = Array.isArray(input) ? input : [input];
  const stints: Stint[] = [];
  tables.forEach((table, tableIndex) => {
    for (const record of table.busts) {
      stints.push({
        personId: record.personId,
        name: record.name,
        visitId: record.visitId,
        tableIndex,
        seatIndex: null,
        order: [record.round, tableIndex],
        buyIn: record.totalBuyIn,
        cashOut: record.bankroll,
        rounds: record.roundsPlayed,
        buyIns: record.buyIns,
        reason: record.reason,
      });
    }
    table.seats.forEach((seat, seatIndex) => {
      if (!seat) return;
      stints.push({
        personId: seat.personId,
        name: seat.name,
        visitId: seat.visitId,
        tableIndex,
        seatIndex,
        order: [Number.POSITIVE_INFINITY, tableIndex],
        buyIn: seat.totalBuyIn,
        cashOut: seat.bankroll,
        rounds: seat.roundsPlayed,
        buyIns: seat.buyIns,
        reason: null,
      });
    });
  });
  // Stable chronological order; within a table, busts are kept newest first, so a tie on the
  // round keeps the older record first by comparing rounds played.
  stints.sort(
    (a, b) => a.order[0] - b.order[0] || a.rounds - b.rounds || a.order[1] - b.order[1],
  );

  const byPerson = new Map<string, PersonLedger>();
  const visitsById = new Map<string, VisitSummary>();
  for (const stint of stints) {
    let ledger = byPerson.get(stint.personId);
    if (!ledger) {
      ledger = {
        personId: stint.personId,
        name: stint.name,
        visits: [],
        seatIndex: null,
        tableIndex: null,
        finishedVisits: 0,
        winningVisits: 0,
        lifetimeNet: 0,
        lifetimeBuyIn: 0,
        lifetimeRounds: 0,
      };
      byPerson.set(stint.personId, ledger);
    }
    ledger.name = stint.name;
    if (stint.seatIndex !== null) {
      ledger.seatIndex = stint.seatIndex;
      ledger.tableIndex = stint.tableIndex;
    }
    const ended = stint.reason !== null && stint.reason !== "switch_table";
    const endRound = Number.isFinite(stint.order[0])
      ? stint.order[0]
      : tables[stint.tableIndex].round;
    let visit = visitsById.get(stint.visitId);
    if (!visit) {
      visit = {
        visitId: stint.visitId,
        buyIn: 0,
        cashOut: 0,
        net: 0,
        rounds: 0,
        buyIns: 0,
        reason: null,
        endRound,
        tables: [],
      };
      visitsById.set(stint.visitId, visit);
      ledger.visits.push(visit);
    }
    // Later stints carry the running totals of the whole visit.
    visit.buyIn = stint.buyIn;
    visit.cashOut = stint.cashOut;
    visit.net = stint.cashOut - stint.buyIn;
    visit.rounds = stint.rounds;
    visit.buyIns = stint.buyIns;
    visit.reason = ended ? stint.reason : null;
    visit.endRound = endRound;
    visit.tables.push(stint.tableIndex);
  }

  for (const ledger of byPerson.values()) {
    for (const visit of ledger.visits) {
      ledger.lifetimeNet += visit.net;
      ledger.lifetimeBuyIn += visit.buyIn;
      ledger.lifetimeRounds += visit.rounds;
      if (visit.reason !== null) {
        ledger.finishedVisits += 1;
        if (visit.net > 0) ledger.winningVisits += 1;
      }
    }
  }
  return [...byPerson.values()];
}

/** Round when this person last finished a visit at any of these tables, or null. */
export function lastLeftRound(input: TableState | TableState[], personId: string): number | null {
  const tables = Array.isArray(input) ? input : [input];
  let latest: number | null = null;
  for (const table of tables) {
    const record = table.busts.find(
      (item) => item.personId === personId && item.reason !== "switch_table",
    );
    if (record && (latest === null || record.round > latest)) latest = record.round;
  }
  return latest;
}
