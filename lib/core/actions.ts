import type { LeaveReason, PlayerProfile, SeatCarry, SeatControl, VisitPlan } from "./types.ts";

export type TableAction =
  | { type: "table/start_round" }
  | { type: "table/advance" }
  | { type: "table/rotate_dealer" }
  | {
      type: "table/leave";
      seatIndex: number;
      reason: LeaveReason;
    }
  | {
      /**
       * The same player buys in again. Only allowed at the moment they would have to leave:
       * the bankroll is below the game's minimum stake (0 after going bust included),
       * or `intended` is a legal bet the current bankroll cannot cover.
       */
      type: "table/rebuy";
      seatIndex: number;
      amount: number;
      intended?: unknown;
    }
  | {
      /**
       * A person sits down for one visit, bringing `profile.bankroll` (required: a multiple of
       * the game's point unit, at least its minimum stake). `plan` is optional. The seat must be
       * empty, and the same person cannot sit in two seats at once.
       */
      type: "table/seat_player";
      seatIndex: number;
      profile: PlayerProfile;
      control: SeatControl;
      plan?: VisitPlan;
      /** Continuing a visit from another table (only switchTable builds this). */
      carry?: SeatCarry;
    }
  | { type: "table/set_control"; seatIndex: number; control: SeatControl };

export interface GameActionEnvelope {
  type: "game/action";
  seatIndex: number;
  action: unknown;
}

export type AnyAction = TableAction | GameActionEnvelope;

export type ActionSpec =
  | { kind: "choice"; options: { id: string; label: string; action: unknown }[] }
  | { kind: "params"; fields: ParamField[] };

export interface ParamField {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}
