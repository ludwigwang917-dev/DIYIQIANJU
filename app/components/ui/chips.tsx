import type { CSSProperties } from "react";

/** 筹码面值与配色（设计定稿：10 象牙 / 50 酒红 / 100 墨黑 / 500 藏青；1、5 用来补足零头）。 */
export const CHIP_STYLES = {
  500: { face: "#17325a", edge: "#efe6d2", side: "#0f2240", side2: "#08162b", text: "#f3e9d4" },
  100: { face: "#1b1b1b", edge: "#d8b36a", side: "#0d0d0d", side2: "#050505", text: "#d8b36a" },
  50: { face: "#7a1a1f", edge: "#efe6d2", side: "#561114", side2: "#3c0b0d", text: "#f3e9d4" },
  10: { face: "#e6dcc4", edge: "#2a4a7a", side: "#b8ad94", side2: "#8f856f", text: "#2a4a7a" },
  5: { face: "#9a5a1e", edge: "#f0e2c4", side: "#6d3e13", side2: "#4d2b0c", text: "#f6ead0" },
  1: { face: "#5d6b62", edge: "#e8e2d2", side: "#414c45", side2: "#2c342f", text: "#f0ebde" },
} as const;

export type ChipValue = keyof typeof CHIP_STYLES;
const DENOMINATIONS: ChipValue[] = [500, 100, 50, 10, 5, 1];

/** 把一个注额拆成筹码（大面值优先），只用于显示。 */
export function chipsFor(amount: number): ChipValue[] {
  const chips: ChipValue[] = [];
  let rest = Math.max(0, Math.floor(amount));
  for (const value of DENOMINATIONS) {
    while (rest >= value) {
      chips.push(value);
      rest -= value;
    }
  }
  return chips;
}

export function chipVars(value: ChipValue): CSSProperties {
  const chip = CHIP_STYLES[value];
  return {
    "--c": chip.face,
    "--edge": chip.edge,
    "--side": chip.side,
    "--side2": chip.side2,
    "--txt": chip.text,
  } as CSSProperties;
}

/** 一摞筹码，最下面是最大面值；顶上那枚印面值。超过 maxVisible 枚时只叠到上限。 */
export function ChipStack({
  amount,
  maxVisible = 8,
  className = "",
  style,
}: {
  amount: number;
  maxVisible?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const chips = chipsFor(amount).slice(0, maxVisible);
  if (!chips.length) return null;
  return (
    <span className={`pe-stack ${className}`} style={style} aria-label={`${amount} 点`}>
      <span className="pe-stack__shadow" />
      {chips.map((value, index) => (
        <span
          key={index}
          className={`pe-chip ${index === chips.length - 1 ? "pe-chip--top" : ""}`}
          data-v={value}
          style={{ ...chipVars(value), bottom: index * 4 }}
        />
      ))}
    </span>
  );
}

/** 下注面板里可点的大筹码。 */
export function ChipButton({
  value,
  disabled,
  onClick,
}: {
  value: ChipValue;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="pe-chipbtn"
      data-v={value}
      style={chipVars(value)}
      disabled={disabled}
      onClick={onClick}
      aria-label={`加 ${value} 点`}
    />
  );
}
