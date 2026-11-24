"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CardFace } from "./card-face";

/**
 * 半月形绿色绒布牌桌（桌面版，设计定稿 design/felt-table-v7.html）。
 * 内部按 STAGE_W × STAGE_H 的固定坐标绘制，再按容器宽度整体等比缩放。
 * 只负责“桌子本身”和座位坐标；牌、筹码、铭牌由调用方通过 children 摆放。
 */

export const STAGE_W = 1120;
export const STAGE_H = 730;
const OFFSET_X = 60;
const CX = 500;
const CY = 170;

/** 5 个座位沿弧线的角度（左到右），0 为正下方。 */
export const SEAT_ANGLES = [-56, -28, 0, 28, 56] as const;

/** 座位上几样东西所在的椭圆半径：下注框、手牌、铭牌。 */
export const RINGS = {
  box: [392, 338],
  hand: [296, 252],
  plaque: [520, 478],
} as const;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** 舞台坐标（已含左侧留白）。 */
export function tablePoint(rx: number, ry: number, deg: number): [number, number] {
  return [OFFSET_X + CX + rx * Math.sin(rad(deg)), CY + ry * Math.cos(rad(deg))];
}

export function seatPoint(seatIndex: number, ring: keyof typeof RINGS): [number, number] {
  const [rx, ry] = RINGS[ring];
  return tablePoint(rx, ry, SEAT_ANGLES[seatIndex] ?? 0);
}

function arc(rx: number, ry: number, deg: number) {
  const [ax, ay] = tablePoint(rx, ry, -deg);
  const [bx, by] = tablePoint(rx, ry, deg);
  return `M${ax.toFixed(1)} ${ay.toFixed(1)} A${rx} ${ry} 0 0 0 ${bx.toFixed(1)} ${by.toFixed(1)}`;
}

/** 把内容摆到某个座位的某一圈上；rotate 为 true 时朝向桌心。 */
export function SeatAnchor({
  seatIndex,
  ring,
  rotate = false,
  children,
  className = "",
  style,
}: {
  seatIndex: number;
  ring: keyof typeof RINGS;
  rotate?: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const [x, y] = seatPoint(seatIndex, ring);
  const angle = SEAT_ANGLES[seatIndex] ?? 0;
  return (
    <div
      className={`pe-anchor ${className}`}
      style={{ left: x, top: y, transform: `translate(-50%, -50%)${rotate ? ` rotate(${-angle}deg)` : ""}`, ...style }}
    >
      {children}
    </div>
  );
}

/** 托盘里的筹码柱颜色（纯装饰）。 */
const TRAY = ["#6e171b", "#6e171b", "#6e171b", "#191919", "#191919", "#16304f", "#16304f", "#e3dac4", "#e3dac4", "#e3dac4", "#4a2a5c", "#25472f"];

export interface FeltTableProps {
  /** 沿弧线印在桌上的赔率说明 */
  oddsText: string;
  /** 桌心的品牌字 */
  brand?: string;
  /** 桌心品牌字下面的一行小字 */
  motto?: string;
  /** 下注框左右两格的名字（如 前注 / 后注）；不传则不分格 */
  boxLabels?: [string, string];
  /** 桌上所有动态内容（荷官手牌、座位手牌、筹码、铭牌），用舞台坐标摆放 */
  children?: ReactNode;
  className?: string;
}

export function FeltTable({
  oddsText,
  brand = "第一千局",
  motto,
  boxLabels,
  children,
  className = "",
}: FeltTableProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const arcId = useId();

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const update = () => setScale(element.clientWidth / STAGE_W);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className={`pe-table-wrap ${className}`} style={{ height: STAGE_H * scale }}>
      <div className="pe-stage" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}>
        <div className="pe-rail"><div className="pe-rail__grain" /></div>
        <div className="pe-trim" />
        <div className="pe-felt">
          <div className="pe-felt__mottle" />
          <div className="pe-felt__fiber" />
          <div className="pe-felt__fluff" />
          <div className="pe-felt__nap" />
          <div className="pe-felt__wear" style={{ background: wearBackground() }} />
          <svg className="pe-felt__print" viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} aria-hidden="true">
            <defs>
              <path id={arcId} d={arc(238, 200, 84)} />
            </defs>
            <path className="pe-print-line" d={arc(440, 392, 84)} opacity={0.5} />
            <path className="pe-print-line" d={arc(436, 388, 84)} opacity={0.25} />
            <path className="pe-print-line" d={arc(342, 292, 76)} />
            <text fontSize={12} letterSpacing={1.5}>
              <textPath href={`#${arcId}`} startOffset="50%" textAnchor="middle">
                {oddsText}
              </textPath>
            </text>
            <g opacity={0.55}>
              <line x1={OFFSET_X + 410} y1={262} x2={OFFSET_X + 590} y2={262} className="pe-print-line" opacity={0.5} />
              <text x={OFFSET_X + CX} y={290} textAnchor="middle" fontSize={28} fontWeight={700} letterSpacing={10}>
                {brand}
              </text>
              {motto && (
                <text x={OFFSET_X + CX} y={309} textAnchor="middle" fontSize={10} letterSpacing={4}>
                  {motto}
                </text>
              )}
            </g>
            {SEAT_ANGLES.map((angle, index) => {
              const [x, y] = seatPoint(index, "box");
              return (
                <g key={index} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${-angle})`}>
                  <rect x={-50} y={-29} width={100} height={58} rx={10} className="pe-print-line" />
                  <rect x={-46} y={-25} width={92} height={50} rx={7} className="pe-print-line" opacity={0.3} />
                  {boxLabels && (
                    <>
                      <line x1={0} y1={-21} x2={0} y2={21} className="pe-print-line" opacity={0.45} />
                      <text x={-24} y={20} textAnchor="middle" fontSize={9} letterSpacing={2}>{boxLabels[0]}</text>
                      <text x={24} y={20} textAnchor="middle" fontSize={9} letterSpacing={2}>{boxLabels[1]}</text>
                    </>
                  )}
                  <text x={0} y={-36} textAnchor="middle" fontSize={11} letterSpacing={2} opacity={0.8}>
                    {`0${index + 1}`}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="pe-felt__light" />
        </div>
        <div className="pe-tray" aria-hidden="true">
          {TRAY.map((color, index) => (
            <i key={index} style={{ background: `repeating-linear-gradient(180deg, ${color} 0 2.5px, rgba(0,0,0,.4) 2.5px 3.5px), ${color}` }} />
          ))}
        </div>
        <div className="pe-shoe" aria-hidden="true">
          <CardFace rank="" suit="" faceUp={false} width={48} className="pe-shoe__card" />
        </div>
        <div className="pe-discard" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <CardFace
              key={index}
              rank=""
              suit=""
              faceUp={false}
              width={44}
              style={{ position: "absolute", left: index * 1.5, top: -index * 2, transform: `rotate(${6 + index * 3}deg)` }}
            />
          ))}
        </div>
        <div className="pe-stage__layer">{children}</div>
      </div>
    </div>
  );
}

/** 荷官发牌区和每个下注框周围“被磨浅”的痕迹（坐标相对桌布）。 */
function wearBackground() {
  const feltLeft = OFFSET_X + 44;
  const feltTop = 64;
  const spots = [`radial-gradient(ellipse 210px 70px at ${CX + OFFSET_X - feltLeft}px ${105}px, rgba(200,230,210,.07), transparent 70%)`];
  SEAT_ANGLES.forEach((_, index) => {
    const [x, y] = seatPoint(index, "box");
    spots.push(
      `radial-gradient(ellipse 80px 60px at ${(x - feltLeft).toFixed(0)}px ${(y - feltTop).toFixed(0)}px, rgba(200,230,210,.06), transparent 70%)`,
    );
  });
  return spots.join(",");
}
