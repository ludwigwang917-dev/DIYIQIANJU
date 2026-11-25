"use client";

/**
 * 底部控制栏里的“谁来下注”：选一个座位，设成托管（并选策略）或手动。
 * 每个座位各自设置；点桌上的铭牌也会切到那个座位。纯显示与收集输入，
 * 真正改控制方式仍走 table/set_control。
 */

export interface StrategyChoice {
  id: string;
  name: string;
}

export type SeatControlValue = { kind: "human" } | { kind: "auto"; strategyId: string };

const NEW_CUSTOM = "__new__";

export function SeatControl({
  seats,
  seatIndex,
  onPickSeat,
  control,
  lastAuto,
  strategies,
  customStrategies,
  editable,
  onSetControl,
  onEditCustom,
  onNewCustom,
  compact = false,
}: {
  /** 有人坐的座位 */
  seats: { index: number; name: string }[];
  seatIndex: number;
  onPickSeat: (index: number) => void;
  control: SeatControlValue;
  /** 切回托管时用的策略（这个座位上次托管用的） */
  lastAuto: string;
  strategies: StrategyChoice[];
  customStrategies: StrategyChoice[];
  /** 只有两局之间才能改 */
  editable: boolean;
  onSetControl: (control: SeatControlValue) => void;
  onEditCustom: (id: string) => void;
  onNewCustom: () => void;
  compact?: boolean;
}) {
  const auto = control.kind === "auto";
  const shownStrategy = auto ? control.strategyId : lastAuto;
  const isCustom = customStrategies.some((item) => item.id === shownStrategy);
  const lockTitle = editable ? undefined : "牌局进行中，下一局开始前才能修改";

  return (
    <div className={`pe-seatctl ${compact ? "pe-seatctl--compact" : ""}`} role="group" aria-label="座位控制方式">
      <label className="pe-seatctl__seat">
        <span className="pe-seatctl__cap">座位</span>
        <select value={seatIndex} onChange={(event) => onPickSeat(Number(event.target.value))} aria-label="选择座位">
          {seats.map((seat) => (
            <option key={seat.index} value={seat.index}>
              {String(seat.index + 1).padStart(2, "0")} · {seat.name}
            </option>
          ))}
        </select>
      </label>

      <div className="pe-seg pe-seatctl__mode" role="radiogroup" aria-label="谁来下注" title={lockTitle}>
        <button
          type="button"
          role="radio"
          aria-checked={auto}
          className={auto ? "is-on" : ""}
          disabled={!editable}
          onClick={() => onSetControl({ kind: "auto", strategyId: lastAuto })}
        >
          托管
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!auto}
          className={!auto ? "is-on" : ""}
          disabled={!editable}
          onClick={() => onSetControl({ kind: "human" })}
        >
          手动
        </button>
      </div>

      <label className={`pe-seatctl__strat ${auto ? "" : "is-muted"}`} title={lockTitle}>
        <span className="pe-seatctl__cap">策略</span>
        <select
          value={shownStrategy}
          disabled={!editable}
          aria-label="托管策略"
          onChange={(event) => {
            const value = event.target.value;
            if (value === NEW_CUSTOM) {
              onNewCustom();
              return;
            }
            onSetControl({ kind: "auto", strategyId: value });
          }}
        >
          <optgroup label="预设策略">
            {strategies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="我的策略">
            {customStrategies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
            <option value={NEW_CUSTOM}>＋ 搭一个新策略…</option>
          </optgroup>
        </select>
      </label>
      {isCustom && (
        <button type="button" className="pe-link-btn pe-seatctl__edit" onClick={() => onEditCustom(shownStrategy)}>
          改
        </button>
      )}
    </div>
  );
}
