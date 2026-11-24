import { useId, type CSSProperties, type ReactNode } from "react";

/**
 * 大号角标矢量牌面（设计定稿见 design/ART_DIRECTION.md、design/felt-table-v7.html）。
 * 花色全部用自绘路径，不依赖系统字体里的 ♠♥ 符号。只负责显示，不含任何规则判断。
 */

type SuitKey = "spade" | "heart" | "club" | "diamond";

const RED_SUITS = new Set(["heart", "diamond"]);
const SUIT_NAME: Record<SuitKey, string> = { spade: "黑桃", heart: "红桃", club: "梅花", diamond: "方块" };

function SuitShape({ suit }: { suit: SuitKey }) {
  switch (suit) {
    case "heart":
      return (
        <path d="M50 92 C22 70 3 52 3 31 C3 15 15 4 29 4 C39 4 46 10 50 19 C54 10 61 4 71 4 C85 4 97 15 97 31 C97 52 78 70 50 92Z" />
      );
    case "diamond":
      return <path d="M50 2 C60 20 74 36 90 50 C74 64 60 80 50 98 C40 80 26 64 10 50 C26 36 40 20 50 2Z" />;
    case "spade":
      return (
        <path d="M50 3 C64 24 97 40 97 62 C97 76 86 84 74 84 C64 84 57 79 54 72 C55 82 60 91 69 97 L31 97 C40 91 45 82 46 72 C43 79 36 84 26 84 C14 84 3 76 3 62 C3 40 36 24 50 3Z" />
      );
    case "club":
      return (
        <>
          <circle cx="50" cy="27" r="22" />
          <circle cx="25" cy="58" r="22" />
          <circle cx="75" cy="58" r="22" />
          <circle cx="50" cy="52" r="12" />
          <path d="M46 52 C46 76 41 88 31 97 L69 97 C59 88 54 76 54 52Z" />
        </>
      );
  }
}

const STAR = "M50 4 L61.8 38.2 L97.6 38.2 L68.9 59.5 L79.4 93.6 L50 72.4 L20.6 93.6 L31.1 59.5 L2.4 38.2 L38.2 38.2Z";

/** 放在 100×140 牌面坐标系里的一个花色，(cx, cy) 为中心，size 为边长。 */
function Pip({ suit, cx, cy, size }: { suit: SuitKey; cx: number; cy: number; size: number }) {
  return (
    <svg x={cx - size / 2} y={cy - size / 2} width={size} height={size} viewBox="0 0 100 100" fill="currentColor">
      <SuitShape suit={suit} />
    </svg>
  );
}

const ORNAMENT: Record<"J" | "Q" | "K", ReactNode> = {
  K: (
    <>
      <path d="M38 33 L37 22 L43.5 27.5 L50 19 L56.5 27.5 L63 22 L62 33Z" fill="#c9a35c" stroke="currentColor" strokeWidth={0.8} />
      <circle cx="50" cy="19" r="1.8" fill="currentColor" />
    </>
  ),
  Q: (
    <>
      <path d="M39 33 Q50 18 61 33Z" fill="#c9a35c" stroke="currentColor" strokeWidth={0.8} />
      <circle cx="44" cy="27" r="1.4" fill="currentColor" />
      <circle cx="50" cy="24" r="1.6" fill="currentColor" />
      <circle cx="56" cy="27" r="1.4" fill="currentColor" />
    </>
  ),
  J: <path d="M44 33 C44 26 50 20 58 19 C54 23 53 28 56 33Z" fill="#c9a35c" stroke="currentColor" strokeWidth={0.8} />,
};

function isCourt(rank: string): rank is "J" | "Q" | "K" {
  return rank === "J" || rank === "Q" || rank === "K";
}

export interface CardFaceProps {
  rank: string;
  suit: string;
  faceUp?: boolean;
  /** 牌宽（px），高度按 1.4 倍 */
  width: number;
  /** 凑成牛的三张：描金边 */
  niu?: boolean;
  /** 输掉的手牌整体压暗 */
  dim?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function CardFace({ rank, suit, faceUp = true, width, niu, dim, className = "", style }: CardFaceProps) {
  const patternId = useId();
  const cardStyle = { "--w": `${width}px`, ...style } as CSSProperties;

  if (!faceUp || !rank) {
    return <span className={`pe-card pe-card--back ${className}`} style={cardStyle} aria-label="牌背" />;
  }

  const joker = rank === "SJ" || rank === "BJ";
  const red = joker ? rank === "BJ" : RED_SUITS.has(suit);
  const court = isCourt(rank);
  const ten = rank === "10";
  const suitKey = suit as SuitKey;
  const label = joker ? (rank === "BJ" ? "大王" : "小王") : `${SUIT_NAME[suitKey] ?? ""}${rank}`;

  let body: ReactNode;
  if (joker) {
    body = (
      <>
        <rect x="4" y="4" width="92" height="132" rx="5" fill="none" stroke="#c9a35c" strokeWidth={1.2} />
        <text className="pe-rk" x="9" y="40" fontSize={36}>王</text>
        <text className="pe-rk" x="13" y="60" fontSize={15}>{rank === "BJ" ? "大" : "小"}</text>
        <rect x="42" y="64" width="50" height="68" rx="3" fill={`url(#${patternId})`} stroke="currentColor" strokeWidth={1} />
        <rect x="45" y="67" width="44" height="62" rx="2" fill="none" stroke="#c9a35c" strokeWidth={0.9} />
        <svg x="50" y="78" width="34" height="34" viewBox="0 0 100 100">
          <path d={STAR} fill={rank === "BJ" ? "currentColor" : "#c9a35c"} stroke="currentColor" strokeWidth={4} />
        </svg>
      </>
    );
  } else {
    body = (
      <>
        <rect
          x="4" y="4" width="92" height="132" rx="5" fill="none"
          stroke={court ? "#c9a35c" : "currentColor"}
          strokeWidth={court ? 1.2 : 0.8}
          opacity={court ? 1 : 0.14}
        />
        <text className="pe-rk" x={ten ? 5 : 9} y="44" fontSize={ten ? 36 : 44} letterSpacing={ten ? -4 : 0}>
          {rank}
        </text>
        <Pip suit={suitKey} cx={21} cy={60} size={17} />
        {court ? (
          <>
            <rect x="42" y="64" width="50" height="68" rx="3" fill={`url(#${patternId})`} stroke="currentColor" strokeWidth={1} />
            <rect x="45" y="67" width="44" height="62" rx="2" fill="none" stroke="#c9a35c" strokeWidth={0.9} />
            <g transform="translate(17 57)">{ORNAMENT[rank]}</g>
            <Pip suit={suitKey} cx={67} cy={108} size={24} />
          </>
        ) : rank === "A" ? (
          <>
            <circle cx="66" cy="102" r="27" fill="none" stroke="currentColor" strokeWidth={0.8} opacity={0.3} />
            <Pip suit={suitKey} cx={66} cy={102} size={40} />
          </>
        ) : (
          <Pip suit={suitKey} cx={68} cy={104} size={46} />
        )}
      </>
    );
  }

  return (
    <span
      className={`pe-card ${red ? "pe-card--red" : ""} ${niu ? "pe-card--niu" : ""} ${dim ? "pe-card--dim" : ""} ${className}`}
      style={cardStyle}
      role="img"
      aria-label={label}
    >
      <svg viewBox="0 0 100 140" aria-hidden="true">
        {(court || joker) && (
          <defs>
            <pattern id={patternId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" fill="#f4e8c8" />
              <rect width="1.4" height="5" fill="#e2cd99" />
            </pattern>
          </defs>
        )}
        {body}
      </svg>
    </span>
  );
}
