import { actForSeat, resolveBustedSeats } from "../auto-play.ts";
import { observe } from "../observe.ts";
import { getGame } from "../registry.ts";
import { mulberry32 } from "../rng.ts";
import { createTable, dispatch, nextToAct } from "../table.ts";
import type { LeaveReason, RoundResult, TableState } from "../types.ts";
import { registerRuleStrategy, type RuleDecision } from "./compile.ts";
import type { RuleStrategy } from "./types.ts";

export interface PreviewRow {
  round: number;
  /** What the strategy decided and why (if it could not afford it, `left` says so). */
  decision: RuleDecision | null;
  /** Worst case this bet could lose. */
  worstLoss: number | null;
  outcome: "win" | "loss" | "push" | null;
  delta: number;
  bankrollAfter: number;
  /** The round as everyone saw it (cards, other seats). */
  record: RoundResult | null;
  /** Set when the seat left the table this round. */
  left: LeaveReason | null;
}

export interface PreviewOptions {
  seed: number;
  rounds?: number;
  bankroll?: number;
  /** Presets sitting next to you, so "what others do" has something to read. */
  companions?: string[];
}

const PREVIEW_ID = "custom-preview";

/**
 * Play a short, seeded run with the strategy in seat 1 and a few regulars beside it, through
 * the real table (same dispatch, same rules), and report every decision. Same seed → same rows.
 */
export function previewRuleStrategy(strategy: RuleStrategy, options: PreviewOptions): PreviewRow[] {
  const { seed, rounds = 20, bankroll = 1000, companions = ["flat", "martingale"] } = options;
  const compiled = registerRuleStrategy(strategy, PREVIEW_ID);
  const mod = getGame(strategy.gameId);
  const rng = mulberry32(seed >>> 0);
  let table: TableState = createTable(strategy.gameId, {
    seats: [
      { profile: { id: "preview-you", name: "你的策略", bankroll }, control: { kind: "auto", strategyId: PREVIEW_ID } },
      ...companions.map((strategyId, index) => ({
        profile: { id: `preview-${index}`, name: `邻座 ${index + 1}`, bankroll: 2000 },
        control: { kind: "auto" as const, strategyId },
      })),
      ...Array(Math.max(0, 4 - companions.length)).fill(null),
    ],
  });

  const rows: PreviewRow[] = [];
  for (let index = 0; index < rounds; index += 1) {
    table = resolveBustedSeats(table, rng);
    if (!table.seats[0]) break;
    const before = table.seats[0];
    table = dispatch(table, { type: "table/start_round" }, rng);
    let decision: RuleDecision | null = null;
    for (let guard = 0; guard <= table.seats.length; guard += 1) {
      const seatIndex = nextToAct(table);
      if (seatIndex == null) break;
      if (seatIndex === 0) {
        const seen = observe(table, 0);
        const state = table.roundCtx!.gameState;
        const seat = table.seats[0]!;
        decision = compiled.explain({
          ...seen,
          spec: seen.spec!,
          check: (action) => mod.validate(state, 0, action, seat),
        });
      }
      table = actForSeat(table, seatIndex, rng);
    }
    while (table.phase !== "idle") table = dispatch(table, { type: "table/advance" }, rng);
    const record = table.roadLog.at(-1) ?? null;
    const mine = record?.seats.find((item) => item.seatIndex === 0) ?? null;
    table = resolveBustedSeats(table, rng);
    const seat = table.seats[0];
    rows.push({
      round: table.round,
      decision,
      worstLoss: decision ? mod.maxLoss(decision.action) : null,
      outcome: mine?.outcome ?? null,
      delta: mine?.delta ?? 0,
      bankrollAfter: seat ? seat.bankroll : (table.busts[0]?.bankroll ?? before.bankroll),
      record,
      left: seat ? null : (table.busts[0]?.reason ?? null),
    });
    if (!seat) break;
  }
  return rows;
}
