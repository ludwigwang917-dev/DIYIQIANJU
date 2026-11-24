import type { ActionSpec } from "../../core/actions.ts";
import type { GameModule, ObservationField } from "../../core/game-module.ts";
import type { Phase, RNG, Settlement } from "../../core/types.ts";
import {
  compareHands,
  evaluateHand,
  shuffle,
  createDeck,
  type EvaluatedHand,
} from "./kernel.ts";
import type { NiuniuView, ViewCard } from "./view.ts";

export interface PlaceBetAction {
  kind: "place_bet";
  front: number;
  back: number;
}

export interface NiuniuGameState {
  dealerHand: EvaluatedHand;
  hands: (EvaluatedHand | null)[];
}

function isPlaceBet(action: unknown): action is PlaceBetAction {
  if (!action || typeof action !== "object") return false;
  const value = action as PlaceBetAction;
  return value.kind === "place_bet";
}

function toViewCards(hand: EvaluatedHand, faceUp: boolean): ViewCard[] {
  if (!faceUp) {
    return Array.from({ length: 5 }, () => ({
      rank: "",
      suit: "",
      faceUp: false,
      dimmed: false,
    }));
  }
  const frontIds = new Set(hand.front.map((card) => card.id));
  return hand.cards.map((card) => ({
    rank: card.rank,
    suit: card.suit,
    faceUp: true,
    dimmed: !frontIds.has(card.id),
  }));
}

/** One hand as everyone saw it after the reveal. */
export interface NiuniuPublicHand {
  label: string;
  /** 0 = 无牛, 1–9 = 牛一…牛九, 10 = 牛牛. */
  cattle: number;
  multiplier: number;
  cards: { rank: string; suit: string }[];
}

/** What a settled niuniu round adds to the table's public record (`RoundResult.detail`). */
export interface NiuniuPublicRound {
  dealer: NiuniuPublicHand;
  /** Hands of the seats that bet, in seat order. */
  seats: (NiuniuPublicHand & { seatIndex: number })[];
}

function publicHand(hand: EvaluatedHand): NiuniuPublicHand {
  return {
    label: hand.label,
    cattle: hand.cattle,
    multiplier: hand.multiplier,
    cards: hand.cards.map((card) => ({ rank: card.rank, suit: card.suit })),
  };
}

const HAND_LABELS = ["无牛", "牛一", "牛二", "牛三", "牛四", "牛五", "牛六", "牛七", "牛八", "牛九", "牛牛"].map(
  (label) => ({ value: label, label }),
);
const RANK_VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "SJ", "BJ"].map(
  (rank) => ({ value: rank, label: rank === "SJ" ? "小王" : rank === "BJ" ? "大王" : rank }),
);
const SUIT_VALUES = [
  { value: "spade", label: "黑桃" },
  { value: "heart", label: "红桃" },
  { value: "club", label: "梅花" },
  { value: "diamond", label: "方块" },
  { value: "joker", label: "王" },
];

function betFields(prefix: string, group: ObservationField["group"], who: string, nullable: boolean): ObservationField[] {
  return [
    { path: `${prefix}.front`, label: `${who}前注`, group, type: "number", unit: "points", nullable },
    { path: `${prefix}.back`, label: `${who}后注`, group, type: "number", unit: "points", nullable },
  ];
}

function handFields(prefix: string, who: string): ObservationField[] {
  return [
    { path: `${prefix}.label`, label: `${who}牌型`, group: "history", type: "enum", values: HAND_LABELS },
    { path: `${prefix}.cattle`, label: `${who}牛值（0 无牛，10 牛牛）`, group: "history", type: "number" },
    { path: `${prefix}.multiplier`, label: `${who}倍率`, group: "history", type: "number", unit: "multiplier" },
    { path: `${prefix}.cards[].rank`, label: `${who}的牌：点数`, group: "history", type: "enum", values: RANK_VALUES },
    { path: `${prefix}.cards[].suit`, label: `${who}的牌：花色`, group: "history", type: "enum", values: SUIT_VALUES },
  ];
}

/** 斗牛特有的、策略能读到的变量（注额、往局牌型与牌面）。通用变量见 lib/core/observe.ts。 */
const NIUNIU_OBSERVATION_FIELDS: ObservationField[] = [
  ...betFields("me.lastBet", "me", "我上局", true),
  ...betFields("seats[].lastBet", "seats", "上局", true),
  ...betFields("seats[].betThisRound", "seats", "本局已下", true),
  ...betFields("history[].seats[].bet", "history", "那局某座", false),
  ...handFields("history[].detail.dealer", "那局庄家"),
  { path: "history[].detail.seats[].seatIndex", label: "那局某座的座位号", group: "history", type: "number" },
  ...handFields("history[].detail.seats[]", "那局某座"),
];

/** 点数的最小单位（2026-11-24 负责人确认）：注额与补仓都按 10 点递增，和最小的 10 点筹码一致。 */
const POINT_UNIT = 10;

const BET_SPEC: ActionSpec = {
  kind: "params",
  fields: [
    { key: "front", label: "前注", min: 0, max: 50, step: POINT_UNIT, defaultValue: 10 },
    { key: "back", label: "后注", min: 0, max: 100, step: POINT_UNIT, defaultValue: 10 },
  ],
};

function isStake(value: number, min: number, max: number) {
  return Number.isInteger(value) && value >= min && value <= max && value % POINT_UNIT === 0;
}

export const niuniuModule: GameModule = {
  id: "niuniu",
  meta: {
    name: "斗牛",
    eyebrow: "NIUNIU / PROBABILITY LAB 01",
    rulesText: [
      "01 · 组牌：每人 5 张牌，扣着发。所有人下注完成后才一起亮牌，下注时谁的牌都看不到。任取 3 张点数和为 10 的倍数（10、20、30 都算）即“有牛”，系统自动选择最优组合。",
      "02 · 点数：A=1，2–10 按牌面，J/Q/K 与大小王均为 10 点。后两张和取个位，整十为牛牛。",
      "03 · 比牌：有牛胜无牛，牛值更大者胜；相同则比较最大单张的点数与花色（大王＞小王＞黑桃＞红桃＞梅花＞方块）。10、J、Q、K 都算 10 点，所以同花色的这几张比起来一样大。完全相同归庄。",
      "04 · 倍率与注额：无牛至牛六 ×1、牛七 ×2、牛八 ×3、牛九 ×4、牛牛 ×5。前注吃倍率，后注始终 ×1。注额以 10 点为单位：前注 0–50，后注 0–100，至少下一处。",
      "05 · 理论期望：庄闲的牌可以互换，输赢两边的倍率正好抵消，庄家优势只来自“完全相同归庄”（平局概率 1.77%）。精确计算：每 1 点前注长期亏 0.0231，每 1 点后注亏 0.0177，约为投注额的 1.77%–2.31%。换什么下注法都只改变波动，不改变这个比例。",
    ].join("\n"),
    educationNotes: [
      "HOUSE EDGE 1.77%–2.31%",
      "前注 EV −0.0231 / 点，后注 EV −0.0177 / 点（精确枚举，见 docs/niuniu-ev-derivation.md）",
      "同点同花色的平局归庄，下注法无法改变单局概率。",
    ],
  },

  createRound(input: { seatIndexes: number[]; rng: RNG }): NiuniuGameState {
    const deck = shuffle(createDeck(), input.rng);
    let cursor = 0;
    const dealerHand = evaluateHand(deck.slice(cursor, (cursor += 5)));
    const maxSeat = Math.max(4, ...input.seatIndexes);
    const hands: (EvaluatedHand | null)[] = Array(maxSeat + 1).fill(null);
    for (const seatIndex of input.seatIndexes) {
      hands[seatIndex] = evaluateHand(deck.slice(cursor, (cursor += 5)));
    }
    return { dealerHand, hands };
  },

  actionSpecFor(state: unknown, seatIndex: number): ActionSpec | null {
    const game = state as NiuniuGameState;
    if (!game.hands[seatIndex]) return null;
    return BET_SPEC;
  },

  validate(_state: unknown, _seatIndex: number, action: unknown): string | null {
    if (!isPlaceBet(action)) return "Action must be place_bet";
    if (!isStake(action.front, 0, 50)) {
      return "front must be a multiple of 10 between 0 and 50";
    }
    if (!isStake(action.back, 0, 100)) {
      return "back must be a multiple of 10 between 0 and 100";
    }
    // 至少下一处：前注可以清零，最小一注是一枚 10 点筹码放在后注。
    if (action.front + action.back < POINT_UNIT) {
      return "bet at least 10 on front or back";
    }
    return null;
  },

  maxLoss(action: unknown): number {
    if (!isPlaceBet(action)) return Number.POSITIVE_INFINITY;
    return action.front * 5 + action.back;
  },

  minStake(): number {
    return niuniuModule.maxLoss({ kind: "place_bet", front: 0, back: POINT_UNIT });
  },

  pointUnit(): number {
    return POINT_UNIT;
  },

  applyAction(state: unknown): unknown {
    return state;
  },

  settle(state: unknown, actions: (unknown | null)[]): Settlement[] {
    const game = state as NiuniuGameState;
    const settlements: Settlement[] = [];
    for (let seatIndex = 0; seatIndex < actions.length; seatIndex += 1) {
      const action = actions[seatIndex];
      const hand = game.hands[seatIndex] ?? null;
      if (!action || !hand || !isPlaceBet(action)) continue;
      const comparison = compareHands(hand, game.dealerHand);
      const playerWon = comparison > 0;
      const winnerMultiplier = playerWon ? hand.multiplier : game.dealerHand.multiplier;
      const requestedDelta =
        (action.front * winnerMultiplier + action.back) * (playerWon ? 1 : -1);
      settlements.push({
        seatIndex,
        delta: requestedDelta,
        outcome: playerWon ? "win" : "loss",
        label: `${hand.label} ×${hand.multiplier}`,
      });
    }
    return settlements;
  },

  // Once the cards are up everyone saw every hand: keep them in the table's public record.
  publicRecord(state: unknown, actions: (unknown | null)[]): NiuniuPublicRound {
    const game = state as NiuniuGameState;
    return {
      dealer: publicHand(game.dealerHand),
      seats: game.hands.flatMap((hand, seatIndex) =>
        hand && actions[seatIndex] ? [{ seatIndex, ...publicHand(hand) }] : [],
      ),
    };
  },

  observationCatalog(): ObservationField[] {
    return NIUNIU_OBSERVATION_FIELDS;
  },

  totalWager(actions: (unknown | null)[]): number {
    let total = 0;
    for (const action of actions) {
      if (isPlaceBet(action)) total += action.front + action.back;
    }
    return total;
  },

  viewOf(state: unknown, _seatIndex: number | null, phase: Phase): NiuniuView {
    const game = state as NiuniuGameState;
    // 先下注、后亮牌（2026-11-24 负责人确认）：发牌和下注阶段所有牌都扣着，
    // 包括庄家和自己的牌，任何人（含全桌总览 seatIndex = null）都看不到；
    // 全部下注完成、进入 showdown 后才一起亮开。否则看牌再定注额就能稳赢。
    const revealed = phase === "showdown" || phase === "settled";

    return {
      dealer: {
        cards: toViewCards(game.dealerHand, revealed),
        label: revealed ? game.dealerHand.label : null,
        multiplier: revealed ? game.dealerHand.multiplier : null,
      },
      seats: game.hands.map((hand, index) => {
        if (!hand) {
          return {
            seatIndex: index,
            participating: false,
            cards: [],
            label: null,
            multiplier: null,
          };
        }
        return {
          seatIndex: index,
          participating: true,
          cards: toViewCards(hand, revealed),
          label: revealed ? hand.label : null,
          multiplier: revealed ? hand.multiplier : null,
        };
      }),
    };
  },
};
