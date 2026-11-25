"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChipButton, type ChipValue } from "./chips";
import { Avatar, formatSigned } from "./plaque";

/**
 * 操作台右侧与座位设置用到的几个面板。都只做显示和收集输入；
 * 下注是否合法、最坏损失、补仓上限等一律由调用方从规则层取来再传入。
 */

const fmt = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);

export interface BetField {
  key: string;
  label: string;
  min: number;
  max: number;
  /** 说明这个注区怎么结算 */
  note: string;
}

export function BetPanel({
  seatNumber,
  seatName,
  bankroll,
  fields,
  values,
  maxLoss,
  otherPending,
  onChange,
  onSubmit,
  onLeave,
  sheet,
}: {
  seatNumber: number;
  seatName: string;
  bankroll: number;
  fields: BetField[];
  values: Record<string, number>;
  /** 规则层 maxLoss(当前注额) 的结果 */
  maxLoss: number;
  /** 除了这一座，还有几个手动座位在等下注 */
  otherPending: number;
  onChange: (values: Record<string, number>) => void;
  onSubmit: () => void;
  onLeave: () => void;
  /** 手机上以底部弹层显示 */
  sheet?: boolean;
}) {
  const [active, setActive] = useState(fields[0]?.key ?? "");
  const field = fields.find((item) => item.key === active) ?? fields[0];
  const current = field ? values[field.key] ?? field.min : 0;
  const tooMuch = maxLoss > bankroll;

  const add = (amount: ChipValue) => {
    if (!field) return;
    onChange({ ...values, [field.key]: Math.min(field.max, current + amount) });
  };

  return (
    <section className={`pe-panel pe-bet ${sheet ? "pe-sheet" : ""}`} aria-label={`${seatNumber} 号座下注`}>
      {sheet && <span className="pe-sheet__grab" aria-hidden="true" />}
      <header className="pe-panel__head">
        <h3>
          轮到 {seatName} 下注 <span>{seatNumber} 号座 · 余额 {fmt(bankroll)}</span>
        </h3>
        {otherPending > 0 && <span className="pe-panel__aside">之后还有 {otherPending} 个手动座位</span>}
      </header>
      <div className="pe-bet__body">
        <div className="pe-bet__slots">
          {fields.map((item) => (
            <button
              type="button"
              key={item.key}
              className={`pe-bet__slot ${item.key === field?.key ? "is-active" : ""}`}
              onClick={() => setActive(item.key)}
              aria-pressed={item.key === field?.key}
            >
              <span>{item.label} {item.note}</span>
              <b>{fmt(values[item.key] ?? item.min)}</b>
              <small>上限 {fmt(item.max)}</small>
            </button>
          ))}
        </div>
        <div className="pe-bet__chips">
          {([10, 50, 100, 500] as const).map((value) => (
            <ChipButton key={value} value={value} disabled={!field || current >= field.max || value > field.max} onClick={() => add(value)} />
          ))}
        </div>
      </div>
      <footer className="pe-panel__foot">
        <p className={tooMuch ? "is-warn" : undefined}>
          最多输 <b>{fmt(maxLoss)}</b>
          {tooMuch ? "，超过余额了" : ""}
        </p>
        <button
          type="button"
          className="pe-btn"
          onClick={() => field && onChange({ ...values, [field.key]: field.min })}
        >
          清空
        </button>
        <button type="button" className="pe-btn" onClick={onLeave}>
          离席
        </button>
        <button type="button" className="pe-btn pe-btn--primary" onClick={onSubmit}>
          下注
        </button>
      </footer>
    </section>
  );
}

export function RebuyPanel({
  seatNumber,
  seatName,
  bankroll,
  broke,
  buyIns,
  totalBuyIn,
  initialBankroll,
  amount,
  maxAmount,
  unit = 1,
  onAmount,
  onRebuy,
  onLeave,
  onBack,
  lockedText,
  sheet,
}: {
  seatNumber: number;
  seatName: string;
  bankroll: number;
  /** true：余额归零；false：余额不够这手注 */
  broke: boolean;
  buyIns: number;
  totalBuyIn: number;
  initialBankroll: number;
  amount: number;
  /** 规则层 maxRebuyAmount 的结果 */
  maxAmount: number;
  /** 点数最小单位（规则层 pointUnit），补仓金额按它递增 */
  unit?: number;
  onAmount: (amount: number) => void;
  onRebuy: () => void;
  onLeave: () => void;
  /** 余额还有、只是不够这手注时：回到下注面板改小注额 */
  onBack?: () => void;
  /** 离场计划不许再补（过了止损线、局数到了）时的说明；有它就只能离席 */
  lockedText?: string | null;
  sheet?: boolean;
}) {
  const clamp =(value: number) => Math.max(unit, Math.min(maxAmount, Math.round(value / unit) * unit));
  return (
    <section className={`pe-panel pe-rebuy ${sheet ? "pe-sheet" : ""}`} aria-label={`${seatNumber} 号座补仓`}>
      {sheet && <span className="pe-sheet__grab" aria-hidden="true" />}
      <header className="pe-panel__head">
        <h3>
          {seatName} {broke ? "输光了" : "余额不够这手注"}
          <span>{seatNumber} 号座 · 余额 {fmt(bankroll)}</span>
        </h3>
        <span className="pe-panel__aside">已买入 {buyIns} 次 · 投入 {fmt(totalBuyIn)}</span>
      </header>
      {lockedText ? (
        <p className="pe-rebuy__locked">{lockedText}</p>
      ) : (
      <div className="pe-rebuy__body">
        <label className="pe-rebuy__amount">
          <span>第 {buyIns + 1} 次买入</span>
          <input
            type="number"
            min={unit}
            max={maxAmount}
            step={unit}
            value={amount}
            onChange={(event) => onAmount(Number(event.target.value))}
            aria-label={`${seatName}补仓金额`}
          />
          <small>最多 {fmt(maxAmount)}</small>
        </label>
        <div className="pe-rebuy__quick">
          <button type="button" className="pe-btn" onClick={() => onAmount(clamp(initialBankroll))}>
            = 初始本金 {fmt(initialBankroll)}
          </button>
          <button type="button" className="pe-btn" onClick={() => onAmount(clamp(amount + 100))}>
            +100
          </button>
          <button type="button" className="pe-btn" onClick={() => onAmount(clamp(amount + 500))}>
            +500
          </button>
        </div>
      </div>
      )}
      <footer className="pe-panel__foot">
        <p>
          {lockedText ? (
            <>这趟共投入 <b>{fmt(totalBuyIn)}</b></>
          ) : (
            <>补完累计投入 <b>{fmt(totalBuyIn + amount)}</b></>
          )}
        </p>
        {onBack && (
          <button type="button" className="pe-btn" onClick={onBack}>
            改注额
          </button>
        )}
        <button type="button" className="pe-btn" onClick={onLeave}>
          离席
        </button>
        {!lockedText && (
          <button type="button" className="pe-btn pe-btn--primary" onClick={onRebuy}>
            补仓 {fmt(amount)}
          </button>
        )}
      </footer>
    </section>
  );
}

export interface RoundLogRow {
  seatNumber: number;
  name: string;
  hand: string | null;
  delta: number | null;
  /** 空位或已离场 */
  gone?: boolean;
}

export function RoundLog({
  round,
  dealerLabel,
  rows,
}: {
  round: number;
  dealerLabel: string | null;
  rows: RoundLogRow[];
}) {
  const played = rows.filter((row) => row.delta != null);
  const playersTotal = played.reduce((total, row) => total + (row.delta ?? 0), 0);
  return (
    <section className="pe-panel pe-log" aria-label="上一局">
      <header className="pe-panel__head">
        <h3>{played.length ? `上一局 · 第 ${fmt(round)} 局` : "还没开局"}</h3>
        {played.length > 0 && (
          <span className="pe-panel__aside">
            庄 · {dealerLabel ?? "—"}　<b className="pe-brass">本局庄家 {formatSigned(-playersTotal)}</b>
          </span>
        )}
      </header>
      {played.length ? (
        <>
          <ul className="pe-log__rows">
            {rows.map((row) => (
              <li key={row.seatNumber} className={row.gone || row.delta == null ? "is-gone" : ""}>
                <span className="pe-log__nm">{row.name}</span>
                <span className={`pe-log__hd ${row.delta != null && row.delta > 0 ? "is-win" : ""}`}>{row.hand ?? "—"}</span>
                <span className="pe-log__vs">
                  {row.delta == null ? (row.gone ? "空位" : "本局未参与") : row.delta > 0 ? "赢庄家" : "输给庄家"}
                </span>
                <b className={row.delta == null ? "" : row.delta > 0 ? "is-win" : "is-loss"}>
                  {row.delta == null ? "—" : formatSigned(row.delta)}
                </b>
              </li>
            ))}
          </ul>
          <p className="pe-log__note">
            玩家合计 {formatSigned(playersTotal)}，庄家 {formatSigned(-playersTotal)}，零和。
          </p>
        </>
      ) : (
        <p className="pe-log__note">开局后这里列出每座的牌型和输赢。</p>
      )}
    </section>
  );
}

export interface StrategyOption {
  id: string;
  name: string;
  short: string;
}

export function SeatSettings({
  seatNumber,
  name,
  net,
  control,
  strategies,
  customStrategies = [],
  onEditCustom,
  onNewCustom,
  editable,
  onSetControl,
  onReplace,
  onLeave,
  onClose,
  visitText,
  style,
  sheet,
}: {
  seatNumber: number;
  name: string;
  net: number;
  /** 这一趟带了多少、离场计划、已玩局数 */
  visitText?: string;
  control: { kind: "human" } | { kind: "auto"; strategyId: string };
  strategies: StrategyOption[];
  /** 策略编辑器里搭的、存在这个浏览器里的策略 */
  customStrategies?: StrategyOption[];
  onEditCustom?: (id: string) => void;
  onNewCustom?: () => void;
  /** 只有两局之间才能改 */
  editable: boolean;
  onSetControl: (control: { kind: "human" } | { kind: "auto"; strategyId: string }) => void;
  onReplace: () => void;
  onLeave: () => void;
  onClose: () => void;
  style?: CSSProperties;
  sheet?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [lastAuto, setLastAuto] = useState(control.kind === "auto" ? control.strategyId : strategies[0]?.id ?? "");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return (
    <div ref={ref} className={`pe-pop ${sheet ? "pe-sheet" : ""}`} style={style} role="dialog" aria-label={`${seatNumber} 号座设置`}>
      {sheet && <span className="pe-sheet__grab" aria-hidden="true" />}
      <h4>
        <span className="pe-pop__who">
          <Avatar name={name} size={24} />
          {String(seatNumber).padStart(2, "0")} · {name}
        </span>
        <span className={net > 0 ? "is-win" : net < 0 ? "is-loss" : ""}>总输赢 {formatSigned(net)}</span>
      </h4>
      {!editable && <p className="pe-pop__lock">牌局进行中，下一局开始前才能修改。</p>}
      <div className="pe-seg pe-mode-seg" role="radiogroup" aria-label="谁来下注">
        <button
          type="button"
          role="radio"
          aria-checked={control.kind === "auto"}
          className={control.kind === "auto" ? "is-on" : ""}
          disabled={!editable}
          onClick={() => onSetControl({ kind: "auto", strategyId: lastAuto })}
        >
          <b>托管</b>
          <small>按策略自动下注</small>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={control.kind === "human"}
          className={control.kind === "human" ? "is-on" : ""}
          disabled={!editable}
          onClick={() => onSetControl({ kind: "human" })}
        >
          <b>手动</b>
          <small>你自己点筹码下注</small>
        </button>
      </div>
      {visitText && <p className="pe-pop__visit">{visitText}</p>}
      <ul className={`pe-pop__list ${control.kind === "human" ? "is-muted" : ""}`}>
        {strategies.map((strategy) => {
          const on = control.kind === "auto" && control.strategyId === strategy.id;
          return (
            <li key={strategy.id}>
              <button
                type="button"
                className={on ? "is-on" : ""}
                disabled={!editable}
                onClick={() => {
                  setLastAuto(strategy.id);
                  onSetControl({ kind: "auto", strategyId: strategy.id });
                }}
              >
                <span>{strategy.name}</span>
                <small>{strategy.short}</small>
              </button>
            </li>
          );
        })}
      </ul>
      {(customStrategies.length > 0 || onNewCustom) && (
        <div className={`pe-pop__mine ${control.kind === "human" ? "is-muted" : ""}`}>
          <span className="pe-label">我的策略</span>
          <ul className="pe-pop__list">
            {customStrategies.map((strategy) => {
              const on = control.kind === "auto" && control.strategyId === strategy.id;
              return (
                <li key={strategy.id} className="pe-pop__custom">
                  <button
                    type="button"
                    className={on ? "is-on" : ""}
                    disabled={!editable}
                    onClick={() => {
                      setLastAuto(strategy.id);
                      onSetControl({ kind: "auto", strategyId: strategy.id });
                    }}
                  >
                    <span>{strategy.name}</span>
                    <small>{strategy.short}</small>
                  </button>
                  {onEditCustom && (
                    <button type="button" className="pe-pop__edit" onClick={() => onEditCustom(strategy.id)} aria-label={`编辑「${strategy.name}」`}>
                      改
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {onNewCustom && (
            <button type="button" className="pe-link-btn" onClick={onNewCustom}>
              ＋ 搭一个新策略
            </button>
          )}
        </div>
      )}
      <div className="pe-pop__acts">
        <button type="button" className="pe-btn" disabled={!editable} onClick={onReplace}>
          换一位赌客
        </button>
        <button type="button" className="pe-btn" disabled={!editable} onClick={onLeave}>
          请离席
        </button>
      </div>
    </div>
  );
}
