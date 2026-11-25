/**
 * 座位铭牌（设计定稿：只放六样——头像、姓名、策略、总输赢、本局牛几、本局倍数）。
 * 纯显示组件；数据由 Simulator 从赌桌状态整理好再传进来。
 */

export type MultTone = "win" | "loss" | "idle";

export interface PlaqueData {
  name: string;
  /** 策略名或“手动” */
  tag: string;
  /** 总输赢：当前余额 − 累计投入 */
  net: number;
  /** 本局牛几（如“牛五”），没有就 null */
  handLabel: string | null;
  /** 右侧标签：本局倍数（×N）或状态（待下注、补仓或离席…） */
  badge: { text: string; tone: MultTone } | null;
  manual: boolean;
  won: boolean;
  /** 输光、等待补仓/离席决定 */
  broke: boolean;
  /** 最近一次开牌这个座位的输赢（开牌后一直显示到下次开牌）；没参与就 null */
  lastDelta: number | null;
  /** 输赢前缀：刚开牌时“本局”，下一局开牌前“上局” */
  lastTag: string;
}

export function formatSigned(value: number) {
  const abs = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(Math.abs(value));
  return value > 0 ? `+${abs}` : value < 0 ? `−${abs}` : "0";
}

export function Avatar({ name, size = 36, ring }: { name: string; size?: number; ring?: string }) {
  return (
    <span
      className="pe-av"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.39), ...(ring ? { ["--ring" as string]: ring } : {}) }}
      aria-hidden="true"
    >
      {Array.from(name)[0] ?? "?"}
    </span>
  );
}

export function Plaque({
  data,
  seatNumber,
  onClick,
  compact = false,
}: {
  data: PlaqueData;
  seatNumber: number;
  onClick?: () => void;
  compact?: boolean;
}) {
  const classes = [
    "pe-plaque",
    compact ? "pe-plaque--compact" : "",
    data.manual ? "pe-plaque--manual" : "",
    data.won ? "pe-plaque--won" : "",
    data.broke ? "pe-plaque--broke" : "",
  ].join(" ");
  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-label={`${seatNumber} 号座 ${data.name}，${data.tag}，总输赢 ${formatSigned(data.net)}。点击设置座位`}
    >
      <Avatar name={data.name} size={compact ? 26 : 36} />
      <span className="pe-plaque__info">
        <span className="pe-plaque__nm">
          <b>{data.name}</b>
          <span className={`pe-tag pe-tag--mode ${data.manual ? "is-manual" : "is-auto"}`}>
            {data.manual ? "手动" : <><i>托管</i><span>{data.tag}</span></>}
          </span>
        </span>
        <span className="pe-plaque__row">
          <span className={`pe-plaque__total ${data.net > 0 ? "is-win" : data.net < 0 ? "is-loss" : ""}`}>
            {formatSigned(data.net)}
          </span>
          <span className="pe-plaque__rt">
            {data.handLabel && <span className="pe-plaque__niu">{data.handLabel}</span>}
            {data.badge && <span className={`pe-mult pe-mult--${data.badge.tone}`}>{data.badge.text}</span>}
          </span>
        </span>
        {data.lastDelta !== null && (
          <span className="pe-plaque__last">
            {data.lastTag} <b className={data.lastDelta > 0 ? "is-win" : data.lastDelta < 0 ? "is-loss" : ""}>{formatSigned(data.lastDelta)}</b>
          </span>
        )}
      </span>
    </button>
  );
}

export function EmptySeat({ seatNumber, onClick, compact = false }: { seatNumber: number; onClick?: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      className={`pe-plaque pe-plaque--empty ${compact ? "pe-plaque--compact" : ""}`}
      onClick={onClick}
      aria-label={`${seatNumber} 号座空着，点击选人入座`}
    >
      <span className="pe-av pe-av--empty" style={{ width: compact ? 26 : 36, height: compact ? 26 : 36 }} aria-hidden="true">
        ＋
      </span>
      <span className="pe-plaque__info">
        <span className="pe-plaque__nm">
          <b>空位</b>
        </span>
        <span className="pe-plaque__hint">点击请人入座</span>
      </span>
    </button>
  );
}

/** 庄家最近一次开牌的输赢（跟在庄家结果条后面）。 */
export function DealerLast({ delta, tag }: { delta: number; tag: string }) {
  return (
    <span className="pe-dealer-last">
      庄{tag} <b className={delta > 0 ? "is-win" : delta < 0 ? "is-loss" : ""}>{formatSigned(delta)}</b>
    </span>
  );
}
