import type { CSSProperties } from "react";
import { cardPoint, type Rank, type Suit } from "@/lib/games/niuniu/kernel";
import { CardFace } from "./card-face";

/** 与 lib/games/niuniu/view.ts 的 ViewCard 同形；`dimmed` 由游戏层给出：不在凑牛三张里的牌为 true。 */
export interface HandCard {
  rank: string;
  suit: string;
  faceUp: boolean;
  dimmed: boolean;
}

/**
 * 把手牌按“3 张凑整 + 2 张算点”排开：先放凑牛的三张，再留一道缝放剩下两张。
 * 谁属于凑牛三张完全取自游戏层的 `dimmed`，这里不重算。
 */
export function splitHand(cards: HandCard[]): { front: HandCard[]; back: HandCard[] } {
  return { front: cards.filter((card) => !card.dimmed), back: cards.filter((card) => card.dimmed) };
}

const POINT_LABEL: Record<string, string> = { SJ: "小王", BJ: "大王" };

/** 点数直接用游戏层的 cardPoint，界面不另写一套；算式只给人看，不参与输赢判断。 */
function displayPoint(card: HandCard): number {
  return cardPoint({ id: "", rank: card.rank as Rank, suit: card.suit as Suit });
}

export function handFormula(cards: HandCard[], label: string | null): string | null {
  if (!label || label === "无牛" || cards.some((card) => !card.faceUp)) return null;
  const { front, back } = splitHand(cards);
  if (front.length !== 3 || back.length !== 2) return null;
  const name = (card: HandCard) => POINT_LABEL[card.rank] ?? card.rank;
  const frontSum = front.reduce((total, card) => total + displayPoint(card), 0);
  const backSum = back.reduce((total, card) => total + displayPoint(card), 0);
  return `${front.map(name).join("+")}=${frontSum} · ${back.map(name).join("+")}=${backSum % 10 || 10}`;
}

export interface HandProps {
  cards: HandCard[] | null | undefined;
  /** 单张牌宽（px） */
  width: number;
  /** 相邻两张的水平间距；负数表示叠压 */
  spacing: number;
  /** 第 3、4 张之间额外留的缝 */
  gap: number;
  /** 本手牌型（如“牛七”）；“无牛”时不描金边 */
  label?: string | null;
  /** 输了的一手整体压暗 */
  lost?: boolean;
  /** 每张相对上一张的旋转角度，用于扇形 */
  fan?: number;
  className?: string;
  style?: CSSProperties;
}

export function Hand({ cards, width, spacing, gap, label, lost, fan = 0, className = "", style }: HandProps) {
  const list: HandCard[] =
    cards && cards.length
      ? cards
      : Array.from({ length: 5 }, () => ({ rank: "", suit: "", faceUp: false, dimmed: false }));
  const revealed = list.every((card) => card.faceUp);
  const ordered = revealed ? [...splitHand(list).front, ...splitHand(list).back] : list;
  const hasNiu = revealed && !!label && label !== "无牛";

  return (
    <span className={`pe-hand ${className}`} style={style} aria-label={label ?? "手牌"}>
      {ordered.map((card, index) => (
        <CardFace
          key={`${card.rank}-${card.suit}-${index}`}
          rank={card.rank}
          suit={card.suit}
          faceUp={card.faceUp}
          width={width}
          niu={hasNiu && index < 3}
          dim={lost}
          style={{
            marginLeft: index === 0 ? 0 : index === 3 && revealed ? spacing + gap : spacing,
            transform: fan ? `rotate(${(index - 2) * fan}deg) translateY(${Math.abs(index - 2) * 2}px)` : undefined,
          }}
        />
      ))}
    </span>
  );
}
