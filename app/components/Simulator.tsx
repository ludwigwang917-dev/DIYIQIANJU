"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { AUTO_REBUY, applyVisitPlans, fillAutoSeats, resolveBustedSeats } from "@/lib/core/auto-play";
import { roadMark, seatAt, seatOf, switchTable } from "@/lib/core/casino";
import { lastLeftRound, lifetimeLedgers } from "@/lib/core/lifetime";
import type { MonteCarloResult } from "@/lib/core/monte-carlo";
import { getGame, getStrategies, isCustomStrategyId } from "@/lib/core/registry";
import { decodeShare, shareFromHash } from "@/lib/core/rules/share";
import type { RuleStrategy } from "@/lib/core/rules/types";
import { blankStrategy } from "@/lib/games/niuniu/rule-templates";
import { StrategyEditor } from "./strategy/StrategyEditor";
import { useVariables } from "./strategy/blocks";
import { StrategyBubble, StrategyLog, forgetStrategyNotes, recordStrategyDecision, useStrategyNotes } from "./strategy/live";
import { deleteStrategy, loadSavedStrategies, saveStrategy, type SavedStrategy } from "./strategy/storage";
import {
  DEALERS,
  bustedSeats,
  createTable,
  dispatch,
  maxRebuyAmount,
  minStake,
  pendingSeats,
  pointUnit,
  viewForSeat,
} from "@/lib/core/table";
import type { LeaveReason, Seat, TableState, VisitPlan } from "@/lib/core/types";
import { planBlocksRebuy } from "@/lib/core/visit";
import "@/lib/games/niuniu";
import { PLAYER_PROFILES } from "@/lib/games/niuniu/profiles";
import type { NiuniuView } from "@/lib/games/niuniu/view";
import { ChipStack } from "./ui/chips";
import { FeltTable, SEAT_ANGLES, SeatAnchor, STAGE_W, seatPoint } from "./ui/felt-table";
import { Hand, handFormula, type HandDeal } from "./ui/hand";
import { MobileTable, type SeatModel } from "./ui/mobile-table";
import { BetPanel, RebuyPanel, RoundLog, SeatSettings, type BetField } from "./ui/panels";
import { Avatar, DealerLast, EmptySeat, Plaque, formatSigned, type PlaqueData } from "./ui/plaque";
import { Leaderboard, useLeaderboardSync } from "./ui/leaderboard";
import { Lobby, type LobbyTable } from "./ui/lobby";
import { EntryPanel, LifetimeLedger, planText, type EntryCandidate, type LedgerRow } from "./ui/visit";

/** 牌靴出牌口在桌面舞台上的坐标（见 table.css 的 .pe-shoe）。 */
const SHOE_MOUTH: [number, number] = [902, 162];

/**
 * 发牌动画节奏（毫秒）。8× 自动跑时不播，单步时按 3× 播。
 * AUTO_DELAY 是自动模式每局间隔，要留够发牌 + 翻牌 + 看一眼的时间。
 */
const DEAL_TIMING = {
  1: { step: 40, flight: 360, flip: 260 },
  3: { step: 12, flight: 220, flip: 180 },
} as const;
const AUTO_DELAY = { 1: 2700, 3: 1000, 8: 150 } as const;

function dealTiming(speed: 1 | 3 | 8, running: boolean) {
  if (running && speed === 8) return null;
  return DEAL_TIMING[speed === 1 ? 1 : 3];
}

/** 资金曲线每位赌客一条线的颜色（与牌桌铭牌同一套暖色） */
const LINE_COLORS = ["#cfc4a8", "#7fcfae", "#e27a62", "#8fa7c7", "#d9b46a"];
const GAME_ID = "niuniu";
/** The lobby road shows this many recent rounds; the table's public record keeps more. */
const ROAD_SHOWN = 60;
/** On the live table, auto seats randomly rebuy (AUTO_REBUY) instead of always leaving. */
// onDecide 只用来在牌桌上显示自定义策略为什么这样下注，不影响下注本身。
const AUTO_OPTIONS = { rebuy: true, onDecide: recordStrategyDecision };
const REBUY_RULE_TEXT = `托管赌客每次输到离场时有 ${AUTO_REBUY.probability * 100}% 概率补仓，补初始本金的 ${AUTO_REBUY.minShare * 100}%–${AUTO_REBUY.maxShare * 100}%，最多 ${AUTO_REBUY.maxRebuys} 次`;
/** 斗牛两个注区的结算说明（只是文案，数值上下限取自游戏层的 actionSpec） */
const BET_NOTES: Record<string, string> = { front: "×牌型倍数", back: "×1" };
const ODDS_TEXT = "牛牛 ×5 · 牛九 ×4 · 牛八 ×3 · 牛七 ×2 · 同牌型庄家胜";
const MOBILE_QUERY = "(max-width: 820px)";

const LEAVE_REASON_LABEL: Record<LeaveReason, string> = {
  bankrupt: "余额归零",
  insufficient_funds: "资金不足以按策略下注",
  left: "主动离席",
  stop_win: "赢够了就走",
  stop_loss: "输到止损线",
  time_up: "玩够局数",
  switch_table: "换到别的桌",
};

/** 你自己：不在常客名单里，每趟默认带 1,000、不设离场计划 */
const YOU = { personId: "you", name: "你", bankroll: 1000 } as const;
/** 两局之间，每个空位有这么大概率走进一位常客 */
const WALK_IN_CHANCE = 0.3;
/** 常客离场后至少隔这么多局才会自己再来 */
const COME_BACK_AFTER = 20;

let seatingCounter = 0;
/** 每次入座一个新的 id（同一个人多次进场共用 personId） */
function seatingId(personId: string) {
  seatingCounter += 1;
  return `${personId}#${seatingCounter}`;
}

function randomOf<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** 一位常客走进来坐下（带上惯常的本金和离场习惯）。 */
function seatRegular(table: TableState, seatIndex: number, profile: (typeof PLAYER_PROFILES)[number]) {
  return dispatch(
    table,
    {
      type: "table/seat_player",
      seatIndex,
      profile: { id: seatingId(profile.id), personId: profile.id, name: profile.name, bankroll: profile.bankroll },
      control: { kind: "auto", strategyId: profile.strategyId },
      plan: profile.plan,
    },
    Math.random,
  );
}

/**
 * 不在任何一张桌上的常客；`rested` 为 true 时只要离场够久的。
 * 各桌局数是各自数的，几张桌一起开局，差得不多，用来判断“隔了多久”够用。
 */
function absentRegulars(tables: TableState[], round: number, rested: boolean) {
  const seated = new Set(
    tables.flatMap((table) => table.seats.flatMap((seat) => (seat ? [seat.personId] : []))),
  );
  return PLAYER_PROFILES.filter((profile) => {
    if (seated.has(profile.id)) return false;
    if (!rested) return true;
    const left = lastLeftRound(tables, profile.id);
    return left == null || round - left >= COME_BACK_AFTER;
  });
}

/** 两局之间，这张桌的空位随机有常客走进来（有空位才能坐，坐满了就等）。 */
function walkIns(tables: TableState[], tableIndex: number): TableState[] {
  const table = tables[tableIndex];
  if (table.phase !== "idle") return tables;
  let all = tables;
  table.seats.forEach((seat, seatIndex) => {
    if (seat || Math.random() >= WALK_IN_CHANCE) return;
    const pool = absentRegulars(all, all[tableIndex].round, true);
    if (pool.length === 0) return;
    all = replaceAt(all, tableIndex, seatRegular(all[tableIndex], seatIndex, randomOf(pool)));
  });
  return all;
}

function replaceAt<T>(list: readonly T[], index: number, value: T): T[] {
  return list.map((item, itemIndex) => (itemIndex === index ? value : item));
}

/** 离席时按余额给出真实的原因 */
function leaveReasonFor(seat: Seat, minStakeValue: number): LeaveReason {
  return seat.bankroll <= 0 ? "bankrupt" : seat.bankroll < minStakeValue ? "insufficient_funds" : "left";
}

/** 座位设置里“这一趟”的一行说明 */
function visitLine(seat: Seat) {
  const plan = planText(seat.plan);
  return `这趟带 ${points(seat.initialBankroll)} · 已玩 ${seat.roundsPlayed} 局 · ${plan ?? "没定离场计划"}`;
}

/** 计划不许补仓时，补仓面板上的说明 */
function lockedRebuyText(seat: Seat) {
  if (!planBlocksRebuy(seat)) return null;
  const { stopLoss, maxRounds } = seat.plan;
  if (stopLoss != null && seat.totalBuyIn - seat.bankroll >= stopLoss) {
    return `已经输到这趟定的止损线（输 ${points(stopLoss)} 就走），按计划不能再补，只能离席。`;
  }
  return `这趟定的 ${points(maxRounds ?? 0)} 局已经玩够了，按计划不能再补，只能离席。`;
}

type BetDraft = { front: number; back: number };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function points(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

/** 大厅里的几张桌：开门时坐了不同人数，各有各的荷官。 */
const OPENING_SEATS = [5, 4, 3];

function createInitialCasino(): TableState[] {
  let next = 0;
  return OPENING_SEATS.map((count, tableIndex) => {
    const seats = Array.from({ length: 5 }, (_, seatIndex) => {
      if (seatIndex >= count) return null;
      const profile = PLAYER_PROFILES[next++];
      return {
        profile: { id: `${profile.id}#first`, personId: profile.id, name: profile.name, bankroll: profile.bankroll },
        control: { kind: "auto" as const, strategyId: profile.strategyId },
        plan: profile.plan,
      };
    });
    return createTable(GAME_ID, { seats, dealerIndex: tableIndex * 2 });
  });
}

/** 每张桌各自的“上一局”显示数据 */
interface TableDisplay {
  settlements: { seatIndex: number; delta: number; label?: string }[];
  view: NiuniuView | null;
  bets: (BetDraft | null)[];
  round: number;
  /** 上一局结算时的牌面，给“牌桌数据”里的上一局列表用；下一局扣牌期间不被覆盖。 */
  logView: NiuniuView | null;
}

const EMPTY_DISPLAY: TableDisplay = { settlements: [], view: null, bets: [], round: 0, logView: null };

function createInitialDisplays(): TableDisplay[] {
  return OPENING_SEATS.map(() => EMPTY_DISPLAY);
}

/** 手动座位按自己的计划离场时，给出的提示 */
function planLeaveNotice(before: TableState, after: TableState, tableIndex: number): string | null {
  const humanSeatings = new Set(
    before.seats.flatMap((seat) => (seat?.control.kind === "human" ? [seat.playerId] : [])),
  );
  const leaves = after.busts
    .slice(0, after.busts.length - before.busts.length)
    .filter(
      (record) =>
        humanSeatings.has(record.playerId) &&
        (record.reason === "stop_win" || record.reason === "stop_loss" || record.reason === "time_up"),
    );
  if (!leaves.length) return null;
  return leaves
    .map(
      (record) =>
        `${record.name} 在 ${tableIndex + 1} 号桌按这趟的计划离场（${LEAVE_REASON_LABEL[record.reason]}）：这趟 ${formatSigned(record.bankroll - record.totalBuyIn)}，玩了 ${record.roundsPlayed} 局。`,
    )
    .join(" ");
}

function strategyName(strategyId: string) {
  return getStrategies(GAME_ID).find((item) => item.id === strategyId)?.name ?? strategyId;
}

function asNiuniuView(value: unknown): NiuniuView | null {
  return value as NiuniuView | null;
}

/** 各座本局注额（用来在下注框里摆筹码）；没下注的座位为 null。 */
function betsOf(actions: (unknown | null)[] | undefined): (BetDraft | null)[] {
  return (actions ?? []).map((action) => {
    const bet = action as { kind?: string; front?: number; back?: number } | null;
    return bet?.kind === "place_bet" ? { front: bet.front ?? 0, back: bet.back ?? 0 } : null;
  });
}

function waitingForHuman(table: TableState) {
  return (
    table.phase === "awaiting_bets" &&
    pendingSeats(table).some((index) => table.seats[index]?.control.kind === "human")
  );
}

/** Human seats that went bust and still have to choose between rebuying and leaving. */
function bustedHumanSeats(table: TableState) {
  return bustedSeats(table).filter((index) => table.seats[index]?.control.kind === "human");
}

function bustedNotice(table: TableState) {
  const names = bustedHumanSeats(table).map((index) => table.seats[index]!.name);
  return `${names.join("、")} 输光了：补仓继续玩，或离席。`;
}

/** Chart points for one seat: one per settled round, plus a vertical jump at each rebuy. */
function seatPoints(seat: Seat) {
  const points: { x: number; y: number; rebuy: boolean }[] = [];
  seat.history.forEach((bankroll, round) => {
    points.push({ x: round, y: bankroll, rebuy: false });
    for (const rebuy of seat.rebuys) {
      if (rebuy.roundsPlayed === round) {
        points.push({ x: round, y: rebuy.before + rebuy.amount, rebuy: true });
      }
    }
  });
  return points;
}

function subscribeMobile(callback: () => void) {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

/** 手机竖屏换一套牌桌与操作方式；服务端渲染一律按桌面版输出。 */
function useIsMobile() {
  return useSyncExternalStore(
    subscribeMobile,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

function FundsChart({ table, height = 190 }: { table: TableState; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const series = useMemo(() => {
    const active = table.seats.filter(Boolean).map((seat) => ({
      name: seat!.name,
      points: seatPoints(seat!),
    }));
    return active.slice(0, 5);
  }, [table.seats]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const container = canvas.parentElement;
    if (!container) return;

    const draw = () => {
      const width = Math.max(260, container.clientWidth);
      const ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      context.clearRect(0, 0, width, height);

      const padding = { left: 40, right: 8, top: 10, bottom: 24 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      const allValues = series.flatMap((item) => item.points.map((point) => point.y));
      const maxValue = Math.max(100, ...allValues) * 1.08;
      const maxRound = Math.max(10, table.round);

      context.strokeStyle = "rgba(236, 222, 184, 0.09)";
      context.fillStyle = "rgba(169, 159, 136, 0.85)";
      context.font = "11px Georgia, serif";
      context.lineWidth = 1;
      for (let index = 0; index <= 4; index += 1) {
        const y = padding.top + (chartHeight / 4) * index;
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();
        const value = Math.round(maxValue * (1 - index / 4));
        context.fillText(points(value), 2, y + 4);
      }
      context.fillText("0", padding.left, height - 6);
      context.fillText(`${points(maxRound)} 局`, width - padding.right - 46, height - 6);

      const toX = (round: number) => padding.left + (Math.max(0, round) / maxRound) * chartWidth;
      const toY = (value: number) => padding.top + (1 - value / maxValue) * chartHeight;
      series.forEach((item, seriesIndex) => {
        if (item.points.length === 0) return;
        const color = LINE_COLORS[seriesIndex % LINE_COLORS.length];
        context.strokeStyle = color;
        context.lineWidth = 1.8;
        context.lineJoin = "round";
        context.beginPath();
        item.points.forEach((point, pointIndex) => {
          if (pointIndex === 0) context.moveTo(toX(point.x), toY(point.y));
          else context.lineTo(toX(point.x), toY(point.y));
        });
        context.stroke();
        // Hollow ring where the same player put more points on the table.
        context.fillStyle = "#15120e";
        context.lineWidth = 1.6;
        for (const point of item.points) {
          if (!point.rebuy) continue;
          context.beginPath();
          context.arc(toX(point.x), toY(point.y), 3.5, 0, Math.PI * 2);
          context.fill();
          context.stroke();
        }
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [series, table.round, height]);

  return (
    <div className="pe-chart">
      <canvas ref={canvasRef} aria-label="当前赌客资金随局数变化曲线" role="img" />
      <div className="pe-legend">
        {series.map((item, index) => (
          <span key={`${item.name}-${index}`}>
            <i style={{ background: LINE_COLORS[index % LINE_COLORS.length] }} />
            {item.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function captureTableRound(
  current: TableState,
  lastSettlements: { seatIndex: number; delta: number; label?: string }[],
  lastView: NiuniuView | null,
  lastBets: (BetDraft | null)[],
) {
  let next = current;
  let settlements = lastSettlements;
  let view = lastView;
  let bets = lastBets;
  if (next.phase === "idle") {
    next = applyVisitPlans(resolveBustedSeats(next, Math.random, AUTO_OPTIONS), Math.random);
    // A bust human seat decides (rebuy or leave) before the next round can start.
    if (bustedSeats(next).length > 0 || !next.seats.some(Boolean)) {
      return { table: next, settlements, view, bets };
    }
    next = dispatch(next, { type: "table/start_round" }, Math.random);
  }
  next = fillAutoSeats(next, Math.random, AUTO_OPTIONS);
  for (let guard = 0; guard < 40; guard += 1) {
    if (next.phase === "idle") break;
    if (next.roundCtx) {
      const snap = asNiuniuView(viewForSeat(next, null));
      if (snap) view = snap;
    }
    if (next.phase === "awaiting_bets") {
      const pending = pendingSeats(next);
      if (pending.length === 0) {
        next = dispatch(next, { type: "table/advance" }, Math.random);
        continue;
      }
      const hasHuman = pending.some((index) => next.seats[index]?.control.kind === "human");
      next = fillAutoSeats(next, Math.random, AUTO_OPTIONS);
      if (hasHuman && pendingSeats(next).length > 0) break;
      if (pendingSeats(next).length === 0) {
        next = dispatch(next, { type: "table/advance" }, Math.random);
        continue;
      }
      break;
    }
    if (next.phase === "settled" && next.roundCtx?.settlements) {
      settlements = next.roundCtx.settlements;
      bets = betsOf(next.roundCtx.actions);
      const snap = asNiuniuView(viewForSeat(next, null));
      if (snap) view = snap;
    }
    if (next.phase === "dealing" || next.phase === "showdown" || next.phase === "settled") {
      next = dispatch(next, { type: "table/advance" }, Math.random);
      continue;
    }
    break;
  }
  // Right after settlement, bust auto seats rebuy or leave at once; bust humans are asked.
  // Then every seat whose visit plan is met (stop-win, stop-loss, rounds) goes home.
  next = applyVisitPlans(resolveBustedSeats(next, Math.random, AUTO_OPTIONS), Math.random);
  return { table: next, settlements, view, bets };
}

export default function Simulator() {
  const [casino, setCasino] = useState(createInitialCasino);
  const [viewIndex, setViewIndex] = useState(0);
  const [displays, setDisplays] = useState(createInitialDisplays);
  // Latest tables for event handlers and timers. All dispatches run here, outside React
  // state updaters, so errors thrown by the table layer can actually be caught.
  const casinoRef = useRef(casino);
  const viewRef = useRef(viewIndex);
  const displaysRef = useRef(displays);
  /** The table being watched; handlers read it through this. */
  const tableRef = {
    get current() {
      return casinoRef.current[viewRef.current];
    },
  };
  const table = casino[viewIndex];
  const display = displays[viewIndex];
  const lastSettlements = display.settlements;
  const lastView = display.view;
  const lastBets = display.bets;
  const lastRound = display.round;
  const logView = display.logView;
  const [notice, setNotice] = useState<string | null>(null);
  const [mcError, setMcError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<1 | 3 | 8>(3);
  const [dialog, setDialog] = useState<"rules" | "stats" | null>(null);
  const [strategyId, setStrategyId] = useState("flat");
  const [mcStatus, setMcStatus] = useState<"idle" | "running" | "done">("idle");
  const [mcProgress, setMcProgress] = useState(0);
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [betDrafts, setBetDrafts] = useState<Record<number, BetDraft>>({});
  const [rebuyDrafts, setRebuyDrafts] = useState<Record<number, number>>({});
  const [rebuyOffers, setRebuyOffers] = useState<Record<number, boolean>>({});
  const [mcRebuy, setMcRebuy] = useState(false);
  const [settingsSeat, setSettingsSeat] = useState<number | null>(null);
  const [entrySeat, setEntrySeat] = useState<number | null>(null);
  // 策略编辑器：存在这个浏览器里的策略、正在编辑的那一份、分享链接带来的提示
  const [savedStrategies, setSavedStrategies] = useState<SavedStrategy[]>([]);
  const [editor, setEditor] = useState<{ initial: RuleStrategy; id: string | null; note?: string } | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const isMobile = useIsMobile();
  const strategyNotes = useStrategyNotes();
  const variables = useVariables(GAME_ID);
  const game = getGame(GAME_ID);
  // 预设策略；编辑器里搭的策略注册后也在注册表里，但单独列出
  const strategies = getStrategies(GAME_ID).filter((item) => !isCustomStrategyId(item.id));
  const customOptions = savedStrategies.map((item) => ({
    id: item.id,
    name: item.strategy.name,
    short: item.strategy.rules.length ? `${item.strategy.rules.length} 条规则` : "自定义",
  }));
  const leaderboard = useLeaderboardSync(casino, YOU.personId);
  const pending = pendingSeats(table);
  const minStakeValue = minStake(GAME_ID);
  const unit = pointUnit(GAME_ID);

  const commitCasino = (next: TableState[]) => {
    casinoRef.current = next;
    setCasino(next);
  };

  /** Replace the watched table. */
  const commit = (next: TableState) => {
    commitCasino(replaceAt(casinoRef.current, viewRef.current, next));
  };

  const commitDisplays = (next: TableDisplay[]) => {
    displaysRef.current = next;
    setDisplays(next);
  };

  const showTable = (index: number) => {
    viewRef.current = index;
    setViewIndex(index);
    setSettingsSeat(null);
    setEntrySeat(null);
    setRebuyOffers({});
  };

  /** Apply a table-layer change; on rejection show why instead of crashing the page. */
  const tryCommit = (change: (current: TableState) => TableState, failure: string) => {
    try {
      commit(change(tableRef.current));
      return true;
    } catch (error) {
      setNotice(`${failure}（${errorMessage(error)}）`);
      return false;
    }
  };

  /**
   * Play (or finish) one round at one table of `tables`, then let regulars walk into its
   * empty seats. Pure apart from Math.random; returns the new tables and display.
   */
  const playTableIn = (tables: TableState[], tableIndex: number, shown: TableDisplay) => {
    const current = tables[tableIndex];
    const result = captureTableRound(current, shown.settlements, shown.view, shown.bets);
    const all = walkIns(replaceAt(tables, tableIndex, result.table), tableIndex);
    const settledNow = result.settlements !== shown.settlements;
    const nextDisplay: TableDisplay = {
      settlements: result.settlements,
      view: result.view,
      bets: result.bets,
      round: settledNow ? result.table.round : shown.round,
      logView: settledNow ? result.view : shown.logView,
    };
    return { tables: all, display: nextDisplay, notice: planLeaveNotice(current, result.table, tableIndex) };
  };

  /** Finish the round at the watched table (after a manual bet or leave). */
  const runRound = (current: TableState) => {
    const index = viewRef.current;
    const played = playTableIn(
      replaceAt(casinoRef.current, index, current),
      index,
      displaysRef.current[index],
    );
    commitCasino(played.tables);
    commitDisplays(replaceAt(displaysRef.current, index, played.display));
    if (played.notice) setNotice(played.notice);
    return played.tables[index];
  };

  /** One tick of the casino: every table plays a round. Returns false when auto-play should pause. */
  const stepOnce = (): boolean => {
    let all = casinoRef.current;
    let shown = displaysRef.current;
    try {
      if (all.every((table) => table.phase === "idle" && !table.seats.some(Boolean))) {
        // Nobody anywhere: a regular wanders in at the watched table.
        const pool = absentRegulars(all, all[viewRef.current].round, true);
        const choices = pool.length ? pool : absentRegulars(all, all[viewRef.current].round, false);
        all = replaceAt(all, viewRef.current, seatRegular(all[viewRef.current], 0, randomOf(choices)));
      }
      const notices: string[] = [];
      for (let index = 0; index < all.length; index += 1) {
        const table = all[index];
        // A table waiting on a person (a bet, or rebuy-or-leave) holds until they decide.
        if (waitingForHuman(table) || (table.phase === "idle" && bustedHumanSeats(table).length > 0)) {
          continue;
        }
        const played = playTableIn(all, index, shown[index]);
        all = played.tables;
        shown = replaceAt(shown, index, played.display);
        if (played.notice) notices.push(played.notice);
      }
      commitCasino(all);
      commitDisplays(shown);

      if (notices.length) {
        setNotice(notices.join(" "));
        return false;
      }
      // Someone has to decide: bring that table into view.
      const busted = all.findIndex((table) => table.phase === "idle" && bustedHumanSeats(table).length > 0);
      if (busted >= 0) {
        if (busted !== viewRef.current) showTable(busted);
        setNotice(bustedNotice(all[busted]));
        return false;
      }
      const waiting = all.findIndex((table) => waitingForHuman(table));
      if (waiting >= 0) {
        if (waiting !== viewRef.current) showTable(waiting);
        setNotice(`${waiting + 1} 号桌轮到手动座位下注：点筹码加注后确认，或选择离席。`);
        return false;
      }
      return true;
    } catch (error) {
      setNotice(`模拟已暂停：${errorMessage(error)}`);
      return false;
    }
  };

  const onAutoTick = useEffectEvent(() => {
    if (!stepOnce()) setRunning(false);
  });

  useEffect(() => {
    if (!running) return;
    const delay = AUTO_DELAY[speed];
    const timer = window.setInterval(() => onAutoTick(), delay);
    return () => window.clearInterval(timer);
  }, [running, speed]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  // 读出这个浏览器里存的策略；网址里带着分享的策略时，先校验，再请对方决定要不要打开。
  // 只在浏览器里读（服务端渲染时没有 localStorage 和网址 hash），所以放在挂载后读一次。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSavedStrategies(loadSavedStrategies(GAME_ID));
    const code = shareFromHash(window.location.hash);
    if (!code) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const shared = decodeShare(code, GAME_ID);
    if (shared.strategy) {
      setEditor({ initial: shared.strategy, id: null, note: "这是别人分享给你的策略：先看看规则和预览，保存后才会出现在你的策略里。" });
    } else {
      setShareNotice(`分享链接里的策略打不开：${shared.issues.map((issue) => issue.message).join("；")}`);
    }
  }, []);

  const openEditor = (id: string | null) => {
    const saved = id ? savedStrategies.find((item) => item.id === id) : undefined;
    setSettingsSeat(null);
    setEditor({ initial: saved ? structuredClone(saved.strategy) : blankStrategy(), id: saved ? saved.id : null });
  };

  const saveFromEditor = (strategy: RuleStrategy, id: string | null) => {
    const result = saveStrategy(savedStrategies, id, strategy);
    setSavedStrategies(result.list);
    setEditor(null);
    setStrategyId(result.id);
    setShareNotice(
      result.stored
        ? `「${strategy.name}」已保存。点任意赌客的铭牌就能让他用它托管，或在下面“再开 1,000 桌”里跑它。`
        : `「${strategy.name}」这次能用，但浏览器没让保存（可能是无痕模式），刷新后会消失。`,
    );
  };

  const observedEv = table.totalWagered ? (table.playerNet / table.totalWagered) * 100 : 0;
  const zeroSum = table.dealerProfit + table.playerNet;
  const livePlayers = table.seats.filter(Boolean).length;
  const overview =
    asNiuniuView(table.roundCtx ? viewForSeat(table, null) : null) ?? lastView;

  /** The person in this seat goes home (their visit is recorded) and another regular sits down. */
  const replace = (seatIndex: number) => {
    if (
      tryCommit((current) => {
        let next = current;
        const seat = next.seats[seatIndex];
        if (seat) {
          next = dispatch(
            next,
            { type: "table/leave", seatIndex, reason: leaveReasonFor(seat, minStakeValue) },
            Math.random,
          );
        }
        const others = replaceAt(casinoRef.current, viewRef.current, next);
        const rested = absentRegulars(others, next.round, true);
        const pool = rested.length ? rested : absentRegulars(others, next.round, false);
        return seatRegular(next, seatIndex, randomOf(pool));
      }, "只能在两局之间换人")
    ) {
      setNotice(null);
    }
  };

  /**
   * Take whoever `personId` is, with their chips, from their table to an empty seat at
   * `tableIndex` (the first empty seat when none is given). Returns why not, or null.
   */
  const moveTo = (personId: string, tableIndex: number, seatIndex?: number): string | null => {
    const all = casinoRef.current;
    const from = seatOf(all, personId);
    if (!from) return "不在任何一张桌上";
    const target = all[tableIndex];
    const to = seatIndex ?? target.seats.findIndex((seat) => !seat);
    if (to < 0) return `${tableIndex + 1} 号桌坐满了`;
    if (all[from.tableIndex].phase !== "idle" || target.phase !== "idle") {
      return "要等两张桌这一局都结束才能换";
    }
    try {
      const seat = all[from.tableIndex].seats[from.seatIndex]!;
      commitCasino(switchTable(all, from, { tableIndex, seatIndex: to }, Math.random, seatingId(personId)));
      showTable(tableIndex);
      setNotice(
        `${seat.name} 带着 ${points(seat.bankroll)} 从 ${from.tableIndex + 1} 号桌换到 ${tableIndex + 1} 号桌 ${to + 1} 号座。还是同一趟：这趟到现在 ${formatSigned(seat.bankroll - seat.totalBuyIn)}，已玩 ${seat.roundsPlayed} 局。`,
      );
      return null;
    } catch (error) {
      return `换不了：${errorMessage(error)}`;
    }
  };

  /** Someone sits in an empty seat for one visit. Returns why not, or null when seated. */
  const sitDown = (
    seatIndex: number,
    personId: string,
    bankroll: number,
    plan: VisitPlan,
  ): string | null => {
    const regular = PLAYER_PROFILES.find((profile) => profile.id === personId);
    const name = regular?.name ?? YOU.name;
    try {
      commitCasino(
        seatAt(
          casinoRef.current,
          viewRef.current,
          {
            type: "table/seat_player",
            seatIndex,
            profile: { id: seatingId(personId), personId, name, bankroll },
            control: regular ? { kind: "auto", strategyId: regular.strategyId } : { kind: "human" },
            plan,
          },
          Math.random,
        ),
      );
      setEntrySeat(null);
      setNotice(
        `${name} 在 ${seatIndex + 1} 号座坐下，这趟带 ${points(bankroll)}，${planText(plan) ?? "没定离场计划"}。`,
      );
      return null;
    } catch (error) {
      return `坐不下：${errorMessage(error)}`;
    }
  };

  const setSeatControl = (seatIndex: number, control: Seat["control"]) => {
    tryCommit(
      (current) =>
        dispatch(current, { type: "table/set_control", seatIndex, control }, Math.random),
      "只能在两局之间切换控制方式",
    );
  };

  const rotateDealer = () => {
    tryCommit(
      (current) => dispatch(current, { type: "table/rotate_dealer" }, Math.random),
      "只能在两局之间更换荷官",
    );
  };

  /** After a human acts, let auto seats act and finish the round if nobody is pending. */
  const continueAfterHuman = (next: TableState) => {
    const filled = fillAutoSeats(next, Math.random, AUTO_OPTIONS);
    if (filled.phase === "awaiting_bets" && pendingSeats(filled).length === 0) {
      runRound(filled);
    } else {
      commit(filled);
    }
  };

  const submitHumanBet = (seatIndex: number) => {
    const current = tableRef.current;
    const seat = current.seats[seatIndex];
    if (!seat || !current.roundCtx) return;
    const draft = betDrafts[seatIndex] ?? { front: 10, back: 10 };
    const action = { kind: "place_bet", front: draft.front, back: draft.back };
    if (game.validate(current.roundCtx.gameState, seatIndex, action, seat)) {
      setNotice("注额不合法：以 10 点为单位，前注 0–50，后注 0–100，至少下一处。");
      return;
    }
    const worstLoss = game.maxLoss(action);
    if (worstLoss > seat.bankroll) {
      setNotice(
        `${seat.name} 这手最坏会输 ${points(worstLoss)} 点（前注×5＋后注），超过余额 ${points(seat.bankroll)} 点。请调小注额、补仓，或离席。`,
      );
      setRebuyOffers((current) => ({ ...current, [seatIndex]: true }));
      setRebuyDrafts((current) => ({
        ...current,
        [seatIndex]: Math.max(seat.initialBankroll, worstLoss - seat.bankroll),
      }));
      return;
    }
    try {
      const placed = dispatch(current, { type: "game/action", seatIndex, action }, Math.random);
      // Cleared first: finishing the round may post a plan-exit notice of its own.
      setNotice(null);
      continueAfterHuman(placed);
      setRebuyOffers((offers) => ({ ...offers, [seatIndex]: false }));
    } catch (error) {
      setNotice(`下注未被接受：${errorMessage(error)}`);
    }
  };

  const leaveHumanSeat = (seatIndex: number) => {
    const current = tableRef.current;
    const seat = current.seats[seatIndex];
    if (!seat) return;
    try {
      const left = dispatch(
        current,
        { type: "table/leave", seatIndex, reason: leaveReasonFor(seat, minStakeValue) },
        Math.random,
      );
      setNotice(null);
      continueAfterHuman(left);
      setRebuyOffers((offers) => ({ ...offers, [seatIndex]: false }));
    } catch (error) {
      setNotice(`暂时无法离席：${errorMessage(error)}`);
    }
  };

  const rebuyHumanSeat = (seatIndex: number) => {
    const current = tableRef.current;
    const seat = current.seats[seatIndex];
    if (!seat) return;
    const amount = rebuyDrafts[seatIndex] ?? seat.initialBankroll;
    const belowFloor = seat.bankroll < minStakeValue;
    const draft = betDrafts[seatIndex] ?? { front: 10, back: 10 };
    const intended = belowFloor ? undefined : { kind: "place_bet", front: draft.front, back: draft.back };
    const required = intended ? game.maxLoss(intended) : minStakeValue;
    const limit = maxRebuyAmount(seat);
    if (!Number.isInteger(amount) || amount < unit || amount > limit || amount % unit !== 0) {
      setNotice(`补仓金额须为 ${unit} 的倍数，${unit}–${points(limit)}（单次最多初始本金的 10 倍）。`);
      return;
    }
    if (seat.bankroll + amount < required) {
      setNotice(`补完后余额仍不够：至少要补 ${points(required - seat.bankroll)} 点。`);
      return;
    }
    try {
      const next = dispatch(current, { type: "table/rebuy", seatIndex, amount, intended }, Math.random);
      commit(next);
      setRebuyOffers((offers) => ({ ...offers, [seatIndex]: false }));
      const updated = next.seats[seatIndex]!;
      const nextStep = next.phase === "idle" ? "可以继续开局。" : "可以提交下注了。";
      setNotice(
        `${updated.name} 第 ${updated.buyIns} 次买入 ${points(amount)} 点，累计投入 ${points(updated.totalBuyIn)} 点。${nextStep}`,
      );
    } catch (error) {
      setNotice(`补仓未被接受：${errorMessage(error)}`);
    }
  };

  const resetExperiment = () => {
    setRunning(false);
    setNotice(null);
    setRebuyDrafts({});
    showTable(0);
    commitDisplays(createInitialDisplays());
    commitCasino(createInitialCasino());
    forgetStrategyNotes();
  };

  const runMonteCarlo = () => {
    workerRef.current?.terminate();
    const worker = new Worker(new URL("../../workers/monte-carlo.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    setMcStatus("running");
    setMcProgress(0);
    setMcResult(null);
    setMcError(null);
    worker.onmessage = (event) => {
      if (event.data.type === "progress") setMcProgress(event.data.progress);
      if (event.data.type === "complete") {
        setMcResult(event.data.result);
        setMcProgress(100);
        setMcStatus("done");
        worker.terminate();
      }
      if (event.data.type === "error") {
        setMcError(`实验中断：${event.data.message}`);
        setMcStatus("idle");
        worker.terminate();
      }
    };
    worker.onerror = (event) => {
      setMcError(`实验线程启动或运行失败：${event.message || "未知错误"}`);
      setMcStatus("idle");
      worker.terminate();
    };
    // 编辑器里搭的策略：把规则一起交给后台线程（它看不到页面上注册的策略）
    const rules = savedStrategies.find((item) => item.id === strategyId)?.strategy;
    worker.postMessage({ runs: 1000, maxRounds: 1000, bankroll: 1000, strategyId, rebuy: mcRebuy, rules });
  };

  const toggleRunning = () => {
    if (!running) {
      setNotice(null);
      setSettingsSeat(null);
    }
    setRunning((value) => !value);
  };

  const stepButton = () => {
    setSettingsSeat(null);
    if (stepOnce()) setNotice(null);
  };

  const openSeat = (seatIndex: number) => {
    if (!table.seats[seatIndex]) {
      // Sitting down takes a moment: pause so nobody else takes the seat meanwhile.
      setRunning(false);
      setSettingsSeat(null);
      setEntrySeat((current) => (current === seatIndex ? null : seatIndex));
      return;
    }
    setEntrySeat(null);
    setSettingsSeat((current) => (current === seatIndex ? null : seatIndex));
  };

  const rulesParagraphs = game.meta.rulesText.split("\n");

  // ---------- 显示用数据（都从赌桌状态与游戏层视图整理，不另算规则） ----------
  const dealerName = DEALERS[table.dealerIndex];
  const dealerView = overview?.dealer;
  const dealerResult = dealerView?.label ? `${dealerView.label} ×${dealerView.multiplier}` : null;
  // 先下注、后亮牌：本局进行中但还没亮牌时，提示大家牌是扣着的。
  const dealerWaiting = table.roundCtx && !dealerResult ? "牌已扣发 · 下注后亮牌" : null;
  const dealerFormula = dealerView ? handFormula(dealerView.cards, dealerView.label) : null;
  const showingSettled = !table.roundCtx;
  const settlementBySeat = new Map(lastSettlements.map((item) => [item.seatIndex, item]));
  // 开牌后显示本局输赢，一直留到下次开牌：玩家各自的 delta；庄家按零和取全部玩家之和的相反数。
  const lastTag = showingSettled ? "本局" : "上局";
  const dealerLastDelta = lastSettlements.length ? -lastSettlements.reduce((sum, item) => sum + item.delta, 0) : null;
  const bets = table.roundCtx ? betsOf(table.roundCtx.actions) : lastBets;
  const humanPending =
    table.phase === "awaiting_bets"
      ? pending.filter((index) => table.seats[index]?.control.kind === "human")
      : [];
  const rebuySeat =
    bustedHumanSeats(table)[0] ??
    Object.keys(rebuyOffers)
      .map(Number)
      .find((index) => rebuyOffers[index] && table.seats[index]);
  const betSeat = rebuySeat === undefined ? humanPending[0] : undefined;

  const plaqueFor = (index: number): PlaqueData | null => {
    const seat = table.seats[index];
    if (!seat) return null;
    const view = overview?.seats[index];
    const settlement = showingSettled ? settlementBySeat.get(index) : undefined;
    const broke = seat.bankroll <= 0;
    let badge: PlaqueData["badge"] = null;
    if (broke && seat.control.kind === "human") badge = { text: "补仓或离席", tone: "idle" };
    else if (table.phase === "awaiting_bets") {
      badge = pending.includes(index)
        ? { text: seat.control.kind === "human" ? "待下注" : "下注中", tone: "idle" }
        : { text: "已下注", tone: "idle" };
    } else if (settlement && view?.participating) {
      badge =
        settlement.delta > 0
          ? { text: `×${view.multiplier ?? 1}`, tone: "win" }
          : { text: `×${dealerView?.multiplier ?? 1}`, tone: "loss" };
    }
    return {
      name: seat.name,
      tag: seat.control.kind === "auto" ? strategyName(seat.control.strategyId) : "手动",
      net: seat.bankroll - seat.totalBuyIn,
      handLabel: view?.participating ? view.label : null,
      badge,
      manual: seat.control.kind === "human",
      won: Boolean(settlement && settlement.delta > 0),
      broke,
      lastDelta: settlementBySeat.get(index)?.delta ?? null,
      lastTag,
    };
  };

  // 用自定义策略托管的座位：这一局（或刚结算的那一局）策略的决定和理由
  const strategyNoteFor = (index: number) => {
    const seat = table.seats[index];
    if (!seat || seat.control.kind !== "auto" || !isCustomStrategyId(seat.control.strategyId)) return null;
    const note = strategyNotes.latest(seat.visitId);
    return note && note.round === table.round ? note : null;
  };

  const seatModels: SeatModel[] = table.seats.map((seat, index) => {
    const view = overview?.seats[index];
    const settlement = showingSettled ? settlementBySeat.get(index) : undefined;
    const note = strategyNoteFor(index);
    return {
      index,
      plaque: plaqueFor(index),
      cards: seat && view?.participating ? view.cards : null,
      label: view?.label ?? null,
      lost: Boolean(settlement && settlement.delta < 0),
      note: note ? <StrategyBubble note={note} variables={variables} compact /> : null,
    };
  });
  const tableStrategyNotes = table.seats
    .flatMap((seat) => (seat ? strategyNotes.all(seat.visitId) : []))
    .sort((a, b) => b.round - a.round)
    .slice(0, 10);

  // ---------- 发牌动画（纯显示）：新一局时牌从牌靴一张张飞向各家，发完一起翻开 ----------
  const dealOrder = [...seatModels.filter((model) => model.plaque && model.cards).map((model) => model.index), -1];
  const dealRevealed = Boolean(dealerView?.cards?.length && dealerView.cards.every((card) => card.faceUp));
  const dealKey = `${viewIndex}:${table.roundCtx ? table.round : lastRound}`;
  const [dealSeen, setDealSeen] = useState(dealKey);
  const [dealActive, setDealActive] = useState<{ key: string; revealed: boolean } | null>(null);
  if (dealSeen !== dealKey) {
    // 换桌观看、重置时不播；同一张桌开了新的一局才播。
    const sameTable = dealSeen.split(":")[0] === String(viewIndex);
    setDealSeen(dealKey);
    setDealActive(sameTable && dealTiming(speed, running) ? { key: dealKey, revealed: dealRevealed } : null);
  }
  const timing = dealTiming(speed, running);
  // 手动下注后亮牌会重新挂载牌面，此时不再重播飞牌。
  const dealing = Boolean(timing && dealActive && dealActive.key === dealKey && dealActive.revealed === dealRevealed);
  const dealFor = (seatIndex: number, mobile: boolean): HandDeal | null => {
    if (!dealing || !timing) return null;
    const position = dealOrder.indexOf(seatIndex);
    if (position < 0) return null;
    const count = dealOrder.length;
    const base = {
      first: position * timing.step,
      every: count * timing.step,
      flight: timing.flight,
      flipAt: (5 * count - 1) * timing.step + timing.flight + 120,
      flip: timing.flip,
    };
    if (mobile) return { ...base, from: [0, seatIndex < 0 ? -70 : -220], fromRotate: -12 };
    if (seatIndex < 0) return { ...base, from: [SHOE_MOUTH[0] - 560, SHOE_MOUTH[1] - 168], fromRotate: -10 };
    const [cx, cy] = seatPoint(seatIndex, "hand");
    const angle = SEAT_ANGLES[seatIndex] ?? 0;
    const dx = SHOE_MOUTH[0] - cx;
    const dy = SHOE_MOUTH[1] - cy;
    const rad = (angle * Math.PI) / 180;
    // 座位手牌整体旋转了 −angle 度，把屏幕上的位移换回它自己的坐标系。
    return {
      ...base,
      from: [Math.cos(rad) * dx - Math.sin(rad) * dy, Math.sin(rad) * dx + Math.cos(rad) * dy],
      fromRotate: angle - 10,
    };
  };

  const settingsIndex = settingsSeat ?? -1;
  const settingsTarget = table.seats[settingsIndex] ?? null;
  const settingsStyle = (): CSSProperties => {
    const [x, y] = seatPoint(settingsIndex, "plaque");
    return {
      position: "absolute",
      left: Math.min(Math.max(x, 150), STAGE_W - 150),
      top: y - 44,
      transform: "translate(-50%, -100%)",
    };
  };
  const settingsElement = settingsTarget ? (
    <SeatSettings
      key={`settings-${settingsIndex}`}
      seatNumber={settingsIndex + 1}
      name={settingsTarget.name}
      net={settingsTarget.bankroll - settingsTarget.totalBuyIn}
      control={settingsTarget.control}
      strategies={strategies.map((item) => ({ id: item.id, name: item.name, short: item.short }))}
      customStrategies={customOptions}
      onEditCustom={(id) => openEditor(id)}
      onNewCustom={() => openEditor(null)}
      editable={table.phase === "idle"}
      onSetControl={(control) => setSeatControl(settingsIndex, control)}
      onReplace={() => {
        replace(settingsIndex);
        setSettingsSeat(null);
      }}
      onLeave={() => {
        leaveHumanSeat(settingsIndex);
        setSettingsSeat(null);
      }}
      onClose={() => setSettingsSeat(null)}
      visitText={visitLine(settingsTarget)}
      style={isMobile ? undefined : settingsStyle()}
      sheet={isMobile}
    />
  ) : null;

  // ---------- 一次进场与生涯总账 ----------
  const ledgers = lifetimeLedgers(casino);
  const visitsOf = (personId: string) =>
    ledgers.find((ledger) => ledger.personId === personId)?.visits.length ?? 0;
  const entryIndex = entrySeat ?? -1;
  const entryOpen = entrySeat !== null && !table.seats[entryIndex];
  const youAt = seatOf(casino, YOU.personId);
  const youSeat = youAt ? casino[youAt.tableIndex].seats[youAt.seatIndex] : null;
  const youCandidate: EntryCandidate[] =
    youAt && youAt.tableIndex === viewIndex
      ? []
      : [
          {
            personId: YOU.personId,
            name: YOU.name,
            tag: "手动下注",
            defaultBankroll: YOU.bankroll,
            defaultPlan: {},
            visits: visitsOf(YOU.personId),
            switchFrom:
              youAt && youSeat
                ? `从 ${youAt.tableIndex + 1} 号桌带 ${points(youSeat.bankroll)} 过来`
                : undefined,
          },
        ];
  const entryCandidates: EntryCandidate[] = entryOpen
    ? [
        ...youCandidate,
        ...absentRegulars(casino, table.round, false).map((profile) => ({
          personId: profile.id,
          name: profile.name,
          tag: `托管 · ${strategyName(profile.strategyId)}`,
          defaultBankroll: profile.bankroll,
          defaultPlan: profile.plan,
          visits: visitsOf(profile.id),
        })),
      ]
    : [];
  // The entry panel is taller than the space above a seat: it opens over the felt, on the seat's side.
  const entryStyle = (): CSSProperties => {
    const [x] = seatPoint(entryIndex, "plaque");
    return {
      position: "absolute",
      left: Math.min(Math.max(x, 170), STAGE_W - 170),
      top: 24,
      transform: "translateX(-50%)",
    };
  };
  const entryElement = entryOpen ? (
    <EntryPanel
      key={`entry-${entryIndex}`}
      seatNumber={entryIndex + 1}
      candidates={entryCandidates}
      unit={unit}
      minBankroll={minStakeValue}
      editable={table.phase === "idle"}
      onSit={(personId, bankroll, plan) => sitDown(entryIndex, personId, bankroll, plan)}
      onSwitch={(personId) => moveTo(personId, viewIndex, entryIndex)}
      onClose={() => setEntrySeat(null)}
      style={isMobile ? undefined : entryStyle()}
      sheet={isMobile}
    />
  ) : null;

  const tagOfPerson = (personId: string, tableIndex: number | null, seatIndex: number | null) => {
    const seat = tableIndex == null || seatIndex == null ? null : casino[tableIndex].seats[seatIndex];
    if (seat) return seat.control.kind === "auto" ? strategyName(seat.control.strategyId) : "手动";
    const regular = PLAYER_PROFILES.find((profile) => profile.id === personId);
    return regular ? strategyName(regular.strategyId) : "手动";
  };
  const ledgerRows: LedgerRow[] = ledgers.map((ledger) => ({
    personId: ledger.personId,
    name: ledger.name,
    tag: tagOfPerson(ledger.personId, ledger.tableIndex, ledger.seatIndex),
    where: ledger.tableIndex == null ? null : `${ledger.tableIndex + 1} 号桌`,
    finishedVisits: ledger.finishedVisits,
    winningVisits: ledger.winningVisits,
    lifetimeNet: ledger.lifetimeNet,
    lifetimeBuyIn: ledger.lifetimeBuyIn,
    visits: ledger.visits.map((visit, index) => ({
      net: visit.net,
      ongoing: visit.reason === null,
      title: `第 ${index + 1} 趟 · ${visit.tables.map((tableIndex) => tableIndex + 1).join("→")} 号桌 · 带 ${points(visit.buyIn)}${visit.buyIns > 1 ? `（${visit.buyIns} 次买入）` : ""} · ${visit.rounds} 局 · ${visit.reason ? LEAVE_REASON_LABEL[visit.reason] : "还在桌上"} · ${formatSigned(visit.net)}`,
    })),
  }));

  // ---------- 大厅 ----------
  const lobbyTables: LobbyTable[] = casino.map((item, index) => {
    const youHere = youAt?.tableIndex === index;
    return {
      index,
      gameName: getGame(item.gameId).meta.name,
      dealerName: DEALERS[item.dealerIndex],
      seats: item.seats.map((seat) =>
        !seat ? "empty" : seat.personId === YOU.personId ? "you" : "taken",
      ),
      road: item.roadLog.slice(-ROAD_SHOWN).map(roadMark),
      dealerProfit: item.dealerProfit,
      rounds: item.round,
      viewing: index === viewIndex,
      youHere,
      canSwitch:
        Boolean(youAt) &&
        !youHere &&
        item.seats.some((seat) => !seat) &&
        item.phase === "idle" &&
        casino[youAt!.tableIndex].phase === "idle",
    };
  });

  const actionPanel = () => {
    if (rebuySeat !== undefined) {
      const seat = table.seats[rebuySeat]!;
      return (
        <RebuyPanel
          seatNumber={rebuySeat + 1}
          seatName={seat.name}
          bankroll={seat.bankroll}
          broke={seat.bankroll <= 0}
          buyIns={seat.buyIns}
          totalBuyIn={seat.totalBuyIn}
          initialBankroll={seat.initialBankroll}
          amount={rebuyDrafts[rebuySeat] ?? seat.initialBankroll}
          maxAmount={maxRebuyAmount(seat)}
          unit={unit}
          onAmount={(amount) => setRebuyDrafts((current) => ({ ...current, [rebuySeat]: amount }))}
          onRebuy={() => rebuyHumanSeat(rebuySeat)}
          onLeave={() => leaveHumanSeat(rebuySeat)}
          onBack={
            seat.bankroll > 0 && table.phase === "awaiting_bets"
              ? () => setRebuyOffers((offers) => ({ ...offers, [rebuySeat]: false }))
              : undefined
          }
          lockedText={lockedRebuyText(seat)}
          sheet={isMobile}
        />
      );
    }
    if (betSeat !== undefined && table.roundCtx) {
      const seat = table.seats[betSeat]!;
      const spec = game.actionSpecFor(table.roundCtx.gameState, betSeat, seat);
      const fields: BetField[] =
        spec?.kind === "params"
          ? spec.fields.map((field) => ({
              key: field.key,
              label: field.label,
              min: field.min,
              max: field.max,
              note: BET_NOTES[field.key] ?? "",
            }))
          : [];
      const draft = betDrafts[betSeat] ?? { front: 10, back: 10 };
      return (
        <BetPanel
          key={`bet-${betSeat}-${table.round}`}
          seatNumber={betSeat + 1}
          seatName={seat.name}
          bankroll={seat.bankroll}
          fields={fields}
          values={draft}
          maxLoss={game.maxLoss({ kind: "place_bet", front: draft.front, back: draft.back })}
          otherPending={humanPending.length - 1}
          onChange={(values) =>
            setBetDrafts((current) => ({
              ...current,
              [betSeat]: { front: values.front ?? draft.front, back: values.back ?? draft.back },
            }))
          }
          onSubmit={() => submitHumanBet(betSeat)}
          onLeave={() => leaveHumanSeat(betSeat)}
          sheet={isMobile}
        />
      );
    }
    return null;
  };
  const hasPanel = rebuySeat !== undefined || (betSeat !== undefined && Boolean(table.roundCtx));
  const noticeElement = notice ? (
    <p className="pe-notice is-active" role="status">
      {notice}
    </p>
  ) : null;
  const zeroOk = Math.abs(zeroSum) < 0.001;

  return (
    <main className="pe-page">
      <header className="pe-topbar">
        <a href="#simulator" className="pe-brand" aria-label="第一千局首页">
          <span className="pe-seal">千</span>
          <b>第一千局</b>
        </a>
        <div className="pe-badge">
          <i /> 无真实货币 · 纯模拟 · 教育目的
        </div>
        <nav aria-label="辅助导航">
          <button onClick={() => setDialog("rules")}>规则</button>
          <a href="#help" className="is-help">
            求助
          </a>
        </nav>
      </header>

      <section className="pe-hero" id="simulator">
        <h1>
          到第一千局，<em>谁还在桌上？</em>
        </h1>
      </section>

      <section className="pe-main">
        <div className="pe-tablecol">
          {isMobile ? (
            <MobileTable
              dealerName={dealerName}
              dealerNote={`${viewIndex + 1} 号桌 · ${game.meta.name}`}
              dealerCards={dealerView?.cards ?? null}
              dealerResult={dealerResult}
              dealerLastDelta={dealerLastDelta}
              lastTag={lastTag}
              waitingText={dealerWaiting ?? "等待开局"}
              formula={dealerFormula}
              seats={seatModels}
              onDealerClick={rotateDealer}
              onSeatClick={openSeat}
              dealFor={(seatIndex) => dealFor(seatIndex, true)}
            />
          ) : (
            <FeltTable oddsText={ODDS_TEXT} boxLabels={["前注", "后注"]}>
              <button type="button" className="pe-dealer" onClick={rotateDealer} aria-label="更换荷官">
                <Avatar name={dealerName} size={34} ring="#c9a35c" />
                <b>
                  {viewIndex + 1} 号桌 · 荷官 {dealerName}
                </b>
              </button>
              <div className="pe-anchor pe-dealer-hand">
                <Hand cards={dealerView?.cards} label={dealerView?.label} width={58} spacing={8} gap={14} deal={dealFor(-1, false)} />
              </div>
              <div className="pe-anchor pe-result pe-result--table">
                {dealerFormula && <em>{dealerFormula}</em>}
                <b>{dealerResult ? `庄 · ${dealerResult}` : (dealerWaiting ?? "等待开局")}</b>
                {dealerLastDelta !== null && <DealerLast delta={dealerLastDelta} tag={lastTag} />}
              </div>
              {seatModels.map((model) => {
                const bet = bets[model.index];
                return (
                  <div key={model.index}>
                    {model.plaque && model.cards && (
                      <SeatAnchor seatIndex={model.index} ring="hand" rotate>
                        <Hand cards={model.cards} label={model.label} lost={model.lost} width={46} spacing={-28} gap={6} fan={4} deal={dealFor(model.index, false)} />
                      </SeatAnchor>
                    )}
                    {model.plaque && bet && (
                      <SeatAnchor seatIndex={model.index} ring="box" rotate>
                        <span className="pe-bets">
                          <ChipStack amount={bet.front} />
                          <ChipStack amount={bet.back} />
                        </span>
                      </SeatAnchor>
                    )}
                    {!model.plaque && (
                      <SeatAnchor seatIndex={model.index} ring="box" rotate>
                        <span className="pe-ash" aria-hidden="true">
                          {[0, 1, 2, 3, 4, 5].map((ember) => (
                            <i key={ember} style={{ left: 8 + ember * 10, top: 14 - (ember % 2) * 6, animationDelay: `${ember * 0.65}s` }} />
                          ))}
                        </span>
                      </SeatAnchor>
                    )}
                    <SeatAnchor seatIndex={model.index} ring="plaque" className={`pe-plaque-anchor pe-plaque-anchor--s${model.index}`}>
                      {model.plaque && strategyNoteFor(model.index) && (
                        <StrategyBubble note={strategyNoteFor(model.index)!} variables={variables} />
                      )}
                      {model.plaque ? (
                        <Plaque data={model.plaque} seatNumber={model.index + 1} onClick={() => openSeat(model.index)} />
                      ) : (
                        <EmptySeat seatNumber={model.index + 1} onClick={() => openSeat(model.index)} />
                      )}
                    </SeatAnchor>
                  </div>
                );
              })}
              {settingsElement}
              {entryElement}
            </FeltTable>
          )}

          {!isMobile && (
            <div className={`pe-ctrlbar ${hasPanel ? "is-covered" : ""}`}>
              <button className="pe-btn pe-btn--primary pe-ctrlbar__main" onClick={toggleRunning}>
                <span aria-hidden="true">{running ? "Ⅱ" : "▶"}</span>
                {running ? "暂停" : table.round === 0 ? "开始" : "继续"}
              </button>
              <button className="pe-btn" onClick={stepButton} disabled={running}>
                单步
              </button>
              <button className="pe-btn" onClick={resetExperiment}>
                重置
              </button>
              <div className="pe-seg pe-speed" aria-label="模拟速度">
                {[1, 3, 8].map((value) => (
                  <button
                    key={value}
                    className={speed === value ? "is-on" : ""}
                    onClick={() => setSpeed(value as 1 | 3 | 8)}
                  >
                    {value}×
                  </button>
                ))}
              </div>
            </div>
          )}
          {(!hasPanel || isMobile) && noticeElement}
          <div className={hasPanel && !isMobile ? "pe-float" : undefined}>
            {hasPanel && !isMobile && noticeElement}
            {actionPanel()}
          </div>
        </div>
      </section>

      <Lobby
        tables={lobbyTables}
        onView={showTable}
        onSwitch={(index) => {
          const reason = moveTo(YOU.personId, index);
          if (reason) setNotice(reason);
        }}
      />

      <section className="pe-stats" id="evidence">
        <header className="pe-stats__head">
          <h2>{viewIndex + 1} 号桌数据</h2>
          <span>
            第 <b>{points(table.round)}</b> 局 · 在座 <b>{livePlayers}</b>/5
          </span>
          <button onClick={() => setDialog("stats")}>全桌统计 ↗</button>
        </header>
        <div className="pe-stats__grid">
          <div className="pe-stats__col">
            <article className="pe-card-panel">
              <span className="pe-label">玩家净收益</span>
              <strong className={`pe-big ${observedEv >= 0 ? "is-win" : "is-loss"}`}>
                {observedEv >= 0 ? "+" : "−"}
                {Math.abs(observedEv).toFixed(2)}%
              </strong>
              <small className="pe-cap">理论值约 −1.77% 到 −2.31%</small>
            </article>
            <div className="pe-duo">
              <article className="pe-card-panel">
                <span className="pe-label">已离场</span>
                <b className="pe-mid">{table.busts.length}</b>
              </article>
              <article className="pe-card-panel">
                <span className="pe-label">庄家</span>
                <b className="pe-mid pe-brass">{formatSigned(table.dealerProfit)}</b>
              </article>
            </div>
            <article className={`pe-card-panel pe-zero ${zeroOk ? "" : "is-bad"}`}>
              <span className="pe-zero__mark" aria-hidden="true">
                {zeroOk ? "✓" : "!"}
              </span>
              <div>
                <b>零和校验{zeroOk ? "" : "异常"}</b>
                <small className="pe-cap">庄家 + 全部玩家</small>
              </div>
              <span className="pe-zero__num">{zeroSum.toFixed(2)}</span>
            </article>
          </div>

          <article className="pe-card-panel">
            <div className="pe-card-panel__head">
              <span className="pe-label">资金随时间</span>
              <small className="pe-cap">空心圈是补仓</small>
            </div>
            <FundsChart table={table} height={isMobile ? 190 : 300} />
          </article>

          <div className="pe-stats__col">
            <article className="pe-card-panel">
              <span className="pe-label">最近离场</span>
              {table.busts.length ? (
                <ol className="pe-busts">
                  {table.busts.slice(0, 4).map((record) => (
                    <li key={`${record.playerId}-${record.round}`}>
                      <span>
                        {record.name}
                        <small>
                          {LEAVE_REASON_LABEL[record.reason]} · 剩 {points(record.bankroll)}
                          {record.buyIns > 1 && ` · 投入 ${points(record.totalBuyIn)}`}
                        </small>
                      </span>
                      <b>{record.roundsPlayed} 局</b>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="pe-cap">还没有人离场。</p>
              )}
            </article>
            {(savedStrategies.length > 0 || tableStrategyNotes.length > 0) && (
              <StrategyLog notes={tableStrategyNotes} variables={variables} />
            )}
            <RoundLog
              round={lastRound}
              dealerLabel={logView?.dealer.label ? `${logView.dealer.label} ×${logView.dealer.multiplier}` : null}
              rows={table.seats.map((seat, index) => {
                const settlement = settlementBySeat.get(index);
                const view = logView?.seats[index];
                return {
                  seatNumber: index + 1,
                  name: seat?.name ?? `0${index + 1} 号座`,
                  hand: settlement && view?.participating ? view.label : null,
                  delta: settlement ? settlement.delta : null,
                  gone: !seat,
                };
              })}
            />
          </div>
        </div>
        <LifetimeLedger rows={ledgerRows} />
      </section>

      <Leaderboard sync={leaderboard} strategyName={strategyName} />

      <section className="pe-mc" aria-label="蒙特卡洛实验">
        <div className="pe-mc__copy">
          <h2>一次好运不是证据。</h2>
          <div className="pe-strats" role="radiogroup" aria-label="实验策略">
            {strategies.map((strategy) => (
              <button
                key={strategy.id}
                role="radio"
                aria-checked={strategyId === strategy.id}
                className={strategyId === strategy.id ? "is-on" : ""}
                onClick={() => setStrategyId(strategy.id)}
                disabled={mcStatus === "running"}
                title={strategy.short}
              >
                {strategy.name}
              </button>
            ))}
          </div>
          <div className="pe-strats pe-strats--mine" role="radiogroup" aria-label="我的策略">
            {customOptions.map((strategy) => (
              <button
                key={strategy.id}
                role="radio"
                aria-checked={strategyId === strategy.id}
                className={strategyId === strategy.id ? "is-on" : ""}
                onClick={() => setStrategyId(strategy.id)}
                disabled={mcStatus === "running"}
                title={strategy.short}
              >
                {strategy.name}
              </button>
            ))}
            {customOptions.some((item) => item.id === strategyId) && (
              <button className="pe-strats__act" onClick={() => openEditor(strategyId)} disabled={mcStatus === "running"}>
                改这个
              </button>
            )}
            <button className="pe-strats__act" onClick={() => openEditor(null)}>
              ＋ 搭一个自己的策略
            </button>
          </div>
          <label className="pe-toggle" title={REBUY_RULE_TEXT}>
            <input
              type="checkbox"
              checked={mcRebuy}
              onChange={(event) => setMcRebuy(event.target.checked)}
              disabled={mcStatus === "running"}
            />
            <span>允许补仓</span>
          </label>
          <button className="pe-btn pe-btn--primary pe-btn--wide" onClick={runMonteCarlo} disabled={mcStatus === "running"}>
            {mcStatus === "running" ? `计算中 ${mcProgress}%` : `再开 1,000 桌 · ${strategyName(strategyId)}`}
          </button>
        </div>
        <div className="pe-mc__result" aria-live="polite">
          {mcResult ? (
            <>
              <div className="pe-mc__top">
                <div>
                  <span className="pe-label">{mcResult.rebuy ? "补仓后仍离场的概率" : "输到离场的概率"}</span>
                  <strong className="pe-big pe-big--xl is-loss">
                    {(mcResult.bankruptcyRate * 100).toFixed(1)}
                    <i>%</i>
                  </strong>
                </div>
                <small className="pe-cap">
                  归零 {mcResult.bustCount} 次
                  <br />
                  资金不足 {mcResult.insufficientCount} 次
                </small>
              </div>
              <div className="pe-hist" aria-label="离场时间分布">
                {mcResult.buckets.map((value, index) => {
                  const max = Math.max(...mcResult.buckets, 1);
                  return (
                    <i
                      key={index}
                      style={{ height: `${Math.max(3, (value / max) * 100)}%` }}
                      title={`${index * 100}–${(index + 1) * 100} 局：${value} 次`}
                    />
                  );
                })}
              </div>
              <div className="pe-hist__axis">
                <span>第 0 局</span>
                <span>第 {points(mcResult.maxRounds)} 局</span>
              </div>
              <div className="pe-facts">
                <div>
                  中位离场
                  <b>{mcResult.medianBustRound ?? `>${points(mcResult.maxRounds)}`} 局</b>
                </div>
                <div>
                  撑满 {points(mcResult.maxRounds)} 局
                  <b>
                    {mcResult.survivorCount} / {mcResult.runs}
                  </b>
                </div>
                <div>
                  平均期末本金
                  <b>{points(mcResult.averageEndingBankroll)}</b>
                </div>
                {mcResult.netPerPointWagered !== undefined && (
                  <div title="所有桌加起来：输赢 ÷ 投注总额。理论值约 −1.77 到 −2.31">
                    每投注 100 点
                    <b className={mcResult.netPerPointWagered < 0 ? "is-loss" : "is-win"}>
                      {mcResult.netPerPointWagered < 0 ? "−" : "+"}
                      {Math.abs(mcResult.netPerPointWagered * 100).toFixed(2)}
                    </b>
                  </div>
                )}
                {mcResult.rebuy && (
                  <>
                    <div>
                      平均补仓
                      <b>
                        {mcResult.averageRebuys.toFixed(2)} 次
                        <small>（{(mcResult.rebuyRunRate * 100).toFixed(0)}% 补过）</small>
                      </b>
                    </div>
                    <div>
                      平均累计投入
                      <b>{points(mcResult.averageTotalBuyIn)}</b>
                    </div>
                    <div>
                      平均净亏损
                      <b>{points(mcResult.averageNetLoss)}</b>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="pe-mc__empty">
              <div className="pe-orbit">
                <span>1000×</span>
              </div>
              <strong>{mcStatus === "running" ? "正在重复实验" : "选一种策略，看它的结局"}</strong>
              <p>{mcStatus === "running" ? "后台计算，牌桌可以继续玩。" : (mcError ?? "随机模拟，不是对个人未来的预测。")}</p>
              {mcStatus === "running" && (
                <div className="pe-progress">
                  <i style={{ width: `${mcProgress}%` }} />
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="pe-learn">
        <article>
          <span>01</span>
          <h3>策略改变波动，不改变期望</h3>
        </article>
        <article>
          <span>02</span>
          <h3>有限本金扛不住无限重复</h3>
        </article>
        <article>
          <span>03</span>
          <h3>短期赢钱不等于方法有效</h3>
        </article>
      </section>

      <footer className="pe-foot" id="help">
        <div>
          <strong>如果赌博已经影响你的生活</strong>
          <p>停止下注，和信任的人谈谈，尽快寻求当地帮助。</p>
        </div>
        <div className="pe-foot__links">
          <a
            href="https://www.who.int/news-room/fact-sheets/detail/gambling"
            target="_blank"
            rel="noreferrer"
          >
            WHO 赌博危害说明 ↗
          </a>
          <a
            href="https://gamblersanonymous.org/virtual-meetings/"
            target="_blank"
            rel="noreferrer"
          >
            匿名戒赌会线上互助 ↗
          </a>
        </div>
        <small>所有点数均为虚拟，不可购买、提现或兑换。模拟结果不构成博彩建议。</small>
      </footer>

      {isMobile && (
        <div className="pe-dock">
          <button className="pe-btn pe-btn--primary" onClick={toggleRunning}>
            {running ? "Ⅱ　暂停" : table.round === 0 ? "▶　开始" : "▶　继续"}
          </button>
          <button className="pe-btn" onClick={stepButton} disabled={running}>
            单步
          </button>
          <button className="pe-btn" onClick={resetExperiment}>
            重置
          </button>
          <button
            className="pe-btn pe-dock__speed"
            onClick={() => setSpeed((value) => (value === 1 ? 3 : value === 3 ? 8 : 1))}
            aria-label={`模拟速度 ${speed}×，点击切换`}
          >
            {speed}×
          </button>
        </div>
      )}
      {isMobile && (settingsElement || entryElement) && (
        <>
          <div className="pe-scrim" aria-hidden="true" />
          {settingsElement}
          {entryElement}
        </>
      )}

      {dialog && (
        <div className="pe-modal-backdrop" role="presentation" onMouseDown={() => setDialog(null)}>
          <section
            className="pe-modal"
            role="dialog"
            aria-modal="true"
            aria-label={dialog === "rules" ? "规则说明" : "全桌统计"}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="pe-modal__close" onClick={() => setDialog(null)} aria-label="关闭">
              ×
            </button>
            {dialog === "rules" ? (
              <>
                <span className="pe-eyebrow">RULEBOOK</span>
                <h2>本实验采用的斗牛规则</h2>
                <div className="pe-rules">
                  {rulesParagraphs.map((paragraph, index) => {
                    const [title, ...rest] = paragraph.split("：");
                    return (
                      <article key={index}>
                        <b>{title}</b>
                        <p>{rest.join("：")}</p>
                      </article>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <span className="pe-eyebrow">TABLE LEDGER</span>
                <h2>全桌统计</h2>
                <div className="pe-ledger-summary">
                  <span>
                    累计局数<b>{points(table.round)}</b>
                  </span>
                  <span>
                    彻底洗牌<b>{points(table.shuffleCount)}</b>
                  </span>
                  <span>
                    累计投注<b>{points(table.totalWagered)}</b>
                  </span>
                  <span>
                    庄家盈亏<b>{points(table.dealerProfit)}</b>
                  </span>
                </div>
                <div className="pe-ledger">
                  {table.seats.map((seat, index) =>
                    seat ? (
                      <div key={seat.playerId}>
                        <span>
                          0{index + 1} · {seat.name}
                          <small>
                            {seat.control.kind === "auto"
                              ? strategyName(seat.control.strategyId)
                              : "手动"}
                            {` · ${seat.buyIns} 次买入共投入 ${points(seat.totalBuyIn)}`}
                          </small>
                        </span>
                        <span>{seat.roundsPlayed} 局</span>
                        <span>{seat.wins} 胜</span>
                        <b>{points(seat.bankroll)} 点</b>
                      </div>
                    ) : (
                      <div key={index}>
                        <span>0{index + 1} · 空位</span>
                        <span>—</span>
                        <span>—</span>
                        <b>已离席</b>
                      </div>
                    ),
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {editor && (
        <StrategyEditor
          key={editor.id ?? "new"}
          gameId={GAME_ID}
          initial={editor.initial}
          savedId={editor.id}
          note={editor.note}
          onSave={saveFromEditor}
          onDelete={
            editor.id
              ? () => {
                  setSavedStrategies(deleteStrategy(savedStrategies, editor.id!));
                  if (strategyId === editor.id) setStrategyId("flat");
                  setEditor(null);
                }
              : undefined
          }
          onClose={() => setEditor(null)}
        />
      )}
      {shareNotice && (
        <div className="pe-toast" role="status">
          <span>{shareNotice}</span>
          <button type="button" onClick={() => setShareNotice(null)} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}
    </main>
  );
}
