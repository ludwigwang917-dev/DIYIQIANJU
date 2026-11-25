import type {
  DealerObservation,
  MyObservation,
  Observation,
  ObservationField,
  SeatObservation,
} from "./game-module.ts";
import { getGame } from "./registry.ts";
import { DEALERS, DEALER_SHIFT, nextToAct } from "./table.ts";
import type { Seat, TableState } from "./types.ts";
import { visitNet } from "./visit.ts";

/** How many recent departures a strategy can see. */
export const OBSERVED_DEPARTURES = 20;

function seatObservation(table: TableState, seat: Seat, seatIndex: number, me: number): SeatObservation {
  return {
    seatIndex,
    isMe: seatIndex === me,
    name: seat.name,
    personId: seat.personId,
    bankroll: seat.bankroll,
    totalBuyIn: seat.totalBuyIn,
    buyIns: seat.buyIns,
    visitNet: visitNet(seat),
    roundsPlayed: seat.roundsPlayed,
    wins: seat.wins,
    winStreak: seat.winStreak,
    lossStreak: seat.lossStreak,
    lastOutcome: seat.lastOutcome,
    lastBet: seat.lastAction,
    // Chips on the felt are there for everyone to see. Only bets already placed show up,
    // and seats bet in seat order, so this is never anyone's future decision.
    betThisRound:
      table.phase === "awaiting_bets" ? (table.roundCtx?.actions[seatIndex] ?? null) : null,
  };
}

function dealerObservation(table: TableState): DealerObservation {
  const history = table.roadLog;
  // Settled rounds the current dealer has dealt in a row, counted back through the record.
  let roundsThisShift = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].dealerIndex !== table.dealerIndex) break;
    roundsThisShift += 1;
  }
  // The round being bet on, or the next one between rounds.
  const upcoming = table.phase === "idle" ? table.round + 1 : table.round;
  let outcome: "win" | "loss" | "none" = "none";
  let length = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const delta = history[index].dealerDelta;
    const result = delta > 0 ? "win" : delta < 0 ? "loss" : "none";
    if (result === "none") break;
    if (outcome === "none") outcome = result;
    if (result !== outcome) break;
    length += 1;
  }
  return {
    index: table.dealerIndex,
    name: DEALERS[table.dealerIndex] ?? "",
    roundsThisShift,
    roundsLeftInShift: DEALER_SHIFT - ((upcoming - 1) % DEALER_SHIFT),
    streak: { outcome, length },
    profit: table.dealerProfit,
  };
}

/**
 * What `seatIndex` can see right now, exactly as a person sitting there would: the public
 * record of past rounds, the chips and streaks of every seat, the dealer, the bets already on
 * the felt, and the game's view (every card face down while bets are open).
 *
 * It never reads the current round's game state directly, only `viewOf`, so a strategy cannot
 * learn this round's cards, the seed or the deck order (contract test: change only the deck,
 * the observation stays identical).
 *
 * Lists (`history`, `departures`) are the table's own arrays, not copies: read them, never
 * change them.
 */
export function observe(table: TableState, seatIndex: number): Observation {
  const seat = table.seats[seatIndex];
  if (!seat) throw new Error(`Seat ${seatIndex} is empty`);
  const mod = getGame(table.gameId);

  const seats = table.seats.map((item, index) =>
    item ? seatObservation(table, item, index, seatIndex) : null,
  );
  const own = seats[seatIndex]!;
  const { stopWin, stopLoss, maxRounds } = seat.plan;
  const net = visitNet(seat);
  const bettingNow = table.phase === "awaiting_bets" && table.roundCtx;
  const alreadyBet = bettingNow
    ? table.roundCtx!.actions.filter((action) => action != null).length
    : 0;
  const me: MyObservation = {
    ...own,
    initialBankroll: seat.initialBankroll,
    plan: { ...seat.plan },
    planRemaining: {
      toStopWin: stopWin == null ? null : stopWin - net,
      toStopLoss: stopLoss == null ? null : stopLoss + net,
      roundsLeft: maxRounds == null ? null : maxRounds - seat.roundsPlayed,
    },
    betPosition: alreadyBet + 1,
    alreadyBet,
  };

  return {
    gameId: table.gameId,
    round: table.phase === "idle" ? table.round + 1 : table.round,
    shuffleCount: table.shuffleCount,
    me,
    seats,
    dealer: dealerObservation(table),
    totalWagered: table.totalWagered,
    history: table.roadLog,
    departures: table.busts.slice(0, OBSERVED_DEPARTURES),
    view: table.roundCtx ? mod.viewOf(table.roundCtx.gameState, seatIndex, table.phase) : null,
    spec: bettingNow ? mod.actionSpecFor(table.roundCtx!.gameState, seatIndex, seat) : null,
  };
}

/** True when it is this seat's turn to bet (seats bet in seat order). */
export function isMyTurn(table: TableState, seatIndex: number): boolean {
  return nextToAct(table) === seatIndex;
}

const OUTCOMES = [
  { value: "win", label: "赢" },
  { value: "loss", label: "输" },
  { value: "none", label: "还没有" },
];

const SEAT_FIELDS = (prefix: string, group: ObservationField["group"], who: string): ObservationField[] => [
  { path: `${prefix}.bankroll`, label: `${who}本金`, group, type: "number", unit: "points" },
  { path: `${prefix}.totalBuyIn`, label: `${who}累计投入`, group, type: "number", unit: "points" },
  { path: `${prefix}.buyIns`, label: `${who}买入次数`, group, type: "number", unit: "count" },
  { path: `${prefix}.visitNet`, label: `${who}这趟输赢`, group, type: "number", unit: "points" },
  { path: `${prefix}.roundsPlayed`, label: `${who}已玩局数`, group, type: "number", unit: "rounds" },
  { path: `${prefix}.wins`, label: `${who}赢的局数`, group, type: "number", unit: "rounds" },
  { path: `${prefix}.winStreak`, label: `${who}连赢`, group, type: "number", unit: "rounds" },
  { path: `${prefix}.lossStreak`, label: `${who}连输`, group, type: "number", unit: "rounds" },
  { path: `${prefix}.lastOutcome`, label: `${who}上一局`, group, type: "enum", values: OUTCOMES },
];

/**
 * The table-level variables every game shares. Game-specific ones (bets, hand types) come
 * from `GameModule.observationCatalog()`; `observationCatalog(gameId)` returns both.
 */
export const CORE_OBSERVATION_FIELDS: ObservationField[] = [
  ...SEAT_FIELDS("me", "me", "我的"),
  { path: "me.seatIndex", label: "我的座位号（从 0 起）", group: "me", type: "number" },
  { path: "me.initialBankroll", label: "我这趟带来的钱", group: "me", type: "number", unit: "points" },
  { path: "me.planRemaining.toStopWin", label: "离止盈还差", group: "me", type: "number", unit: "points", nullable: true },
  { path: "me.planRemaining.toStopLoss", label: "离止损还能输", group: "me", type: "number", unit: "points", nullable: true },
  { path: "me.planRemaining.roundsLeft", label: "计划还剩几局", group: "me", type: "number", unit: "rounds", nullable: true },
  { path: "me.betPosition", label: "我是第几个下注", group: "me", type: "number", unit: "count" },
  { path: "me.alreadyBet", label: "本局已下注人数", group: "me", type: "number", unit: "count" },

  { path: "dealer.index", label: "荷官编号", group: "dealer", type: "number" },
  { path: "dealer.name", label: "荷官", group: "dealer", type: "text" },
  { path: "dealer.roundsThisShift", label: "荷官本班已发", group: "dealer", type: "number", unit: "rounds" },
  { path: "dealer.roundsLeftInShift", label: "荷官还要发几局才换人", group: "dealer", type: "number", unit: "rounds" },
  {
    path: "dealer.streak.outcome",
    label: "庄家对全桌在连",
    group: "dealer",
    type: "enum",
    values: [
      { value: "win", label: "连赢" },
      { value: "loss", label: "连输" },
      { value: "none", label: "没有" },
    ],
  },
  { path: "dealer.streak.length", label: "庄家连赢/连输局数", group: "dealer", type: "number", unit: "rounds" },
  { path: "dealer.profit", label: "庄家累计输赢", group: "dealer", type: "number", unit: "points" },

  { path: "round", label: "第几局", group: "table", type: "number", unit: "rounds" },
  { path: "shuffleCount", label: "洗牌次数", group: "table", type: "number", unit: "count" },
  { path: "totalWagered", label: "全桌累计投注", group: "table", type: "number", unit: "points" },

  { path: "seats[].seatIndex", label: "座位号（从 0 起）", group: "seats", type: "number" },
  { path: "seats[].isMe", label: "是不是我", group: "seats", type: "boolean" },
  { path: "seats[].name", label: "名字", group: "seats", type: "text" },
  ...SEAT_FIELDS("seats[]", "seats", ""),

  { path: "history[].round", label: "第几局", group: "history", type: "number", unit: "rounds" },
  { path: "history[].dealerIndex", label: "那局的荷官编号", group: "history", type: "number" },
  { path: "history[].dealerDelta", label: "那局庄家输赢", group: "history", type: "number", unit: "points" },
  { path: "history[].playerWins", label: "那局赢庄家的人数", group: "history", type: "number", unit: "count" },
  { path: "history[].playerLosses", label: "那局输给庄家的人数", group: "history", type: "number", unit: "count" },
  { path: "history[].seats[].seatIndex", label: "那局某座的座位号", group: "history", type: "number" },
  { path: "history[].seats[].name", label: "那局某座的名字", group: "history", type: "text" },
  { path: "history[].seats[].delta", label: "那局某座的输赢", group: "history", type: "number", unit: "points" },
  {
    path: "history[].seats[].outcome",
    label: "那局某座的结果",
    group: "history",
    type: "enum",
    values: [
      { value: "win", label: "赢" },
      { value: "loss", label: "输" },
      { value: "push", label: "和" },
    ],
  },

  { path: "departures[].name", label: "离场的人", group: "departures", type: "text" },
  { path: "departures[].round", label: "第几局离场", group: "departures", type: "number", unit: "rounds" },
  {
    path: "departures[].reason",
    label: "离场原因",
    group: "departures",
    type: "enum",
    values: [
      { value: "bankrupt", label: "输光" },
      { value: "insufficient_funds", label: "钱不够下注" },
      { value: "left", label: "主动离席" },
      { value: "stop_win", label: "赢够了" },
      { value: "stop_loss", label: "输到止损线" },
      { value: "time_up", label: "玩够局数" },
      { value: "switch_table", label: "换桌" },
    ],
  },
  { path: "departures[].bankroll", label: "离场时剩下", group: "departures", type: "number", unit: "points" },
  { path: "departures[].totalBuyIn", label: "离场时累计投入", group: "departures", type: "number", unit: "points" },
];

/** Every variable a strategy can read at this game's tables, for the strategy editor. */
export function observationCatalog(gameId: string): ObservationField[] {
  return [...CORE_OBSERVATION_FIELDS, ...(getGame(gameId).observationCatalog?.() ?? [])];
}
