export type Suit = "spade" | "heart" | "club" | "diamond" | "joker";

export type Rank =
  | "A"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "SJ"
  | "BJ";

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
}

export interface EvaluatedHand {
  cards: Card[];
  front: Card[];
  back: Card[];
  cattle: number;
  label: string;
  multiplier: number;
  maxCard: Card;
}

const SUITS: Suit[] = ["diamond", "club", "heart", "spade"];
const RANKS: Rank[] = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];

export const suitSymbol: Record<Suit, string> = {
  spade: "♠",
  heart: "♥",
  club: "♣",
  diamond: "♦",
  joker: "★",
};

export function createDeck(): Card[] {
  const cards = SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({ id: `${suit}-${rank}`, suit, rank })),
  );
  cards.push(
    { id: "joker-SJ", suit: "joker", rank: "SJ" },
    { id: "joker-BJ", suit: "joker", rank: "BJ" },
  );
  return cards;
}

export function shuffle<T>(items: T[], random = Math.random): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function cardPoint(card: Card): number {
  if (card.rank === "A") return 1;
  const parsed = Number(card.rank);
  return Number.isNaN(parsed) ? 10 : parsed;
}

function suitStrength(card: Card): number {
  if (card.rank === "BJ") return 6;
  if (card.rank === "SJ") return 5;
  return { diamond: 1, club: 2, heart: 3, spade: 4, joker: 5 }[
    card.suit
  ];
}

function compareSingleCards(left: Card, right: Card): number {
  return cardPoint(left) - cardPoint(right) || suitStrength(left) - suitStrength(right);
}

function cattleLabel(cattle: number): string {
  if (cattle === 0) return "无牛";
  if (cattle === 10) return "牛牛";
  return `牛${["", "一", "二", "三", "四", "五", "六", "七", "八", "九"][cattle]}`;
}

export function handMultiplier(cattle: number): number {
  if (cattle === 10) return 5;
  if (cattle === 9) return 4;
  if (cattle === 8) return 3;
  if (cattle === 7) return 2;
  return 1;
}

/**
 * Standard rule: any three cards summing to a multiple of 10 (10, 20 or 30) form the
 * "bull"; 30 (three 10-point cards) counts too (changed 2026-11-24, the PRD originally
 * excluded it). Among all valid splits, the best cattle is used.
 */
export function evaluateHand(cards: Card[]): EvaluatedHand {
  if (cards.length !== 5) throw new Error("A Niuniu hand must contain 5 cards");

  let best: { frontIndexes: number[]; cattle: number } | undefined;
  for (let first = 0; first < 3; first += 1) {
    for (let second = first + 1; second < 4; second += 1) {
      for (let third = second + 1; third < 5; third += 1) {
        const frontIndexes = [first, second, third];
        const sum = frontIndexes.reduce((total, index) => total + cardPoint(cards[index]), 0);
        if (sum % 10 !== 0) continue;
        const backSum = cards.reduce(
          (total, card, index) =>
            frontIndexes.includes(index) ? total : total + cardPoint(card),
          0,
        );
        const cattle = backSum % 10 || 10;
        if (!best || cattle > best.cattle) best = { frontIndexes, cattle };
      }
    }
  }

  const frontIndexes = best?.frontIndexes ?? [0, 1, 2];
  const front = cards.filter((_, index) => frontIndexes.includes(index));
  const back = cards.filter((_, index) => !frontIndexes.includes(index));
  const cattle = best?.cattle ?? 0;
  const maxCard = cards.reduce((highest, card) =>
    compareSingleCards(card, highest) > 0 ? card : highest,
  );

  return {
    cards,
    front,
    back,
    cattle,
    label: cattleLabel(cattle),
    multiplier: handMultiplier(cattle),
    maxCard,
  };
}

/** Positive means the player hand wins; zero is a banker-favoured exact tie. */
export function compareHands(player: EvaluatedHand, dealer: EvaluatedHand): number {
  return (
    player.cattle - dealer.cattle ||
    compareSingleCards(player.maxCard, dealer.maxCard)
  );
}

export function dealHands(seatCount: number, random = Math.random) {
  const deck = shuffle(createDeck(), random);
  let cursor = 0;
  const dealer = evaluateHand(deck.slice(cursor, (cursor += 5)));
  const players = Array.from({ length: seatCount }, () =>
    evaluateHand(deck.slice(cursor, (cursor += 5))),
  );
  return { dealer, players };
}

