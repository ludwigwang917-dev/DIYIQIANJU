"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Avatar, formatSigned } from "./plaque";

/**
 * 一次进场：空位入座面板（带多少钱必填，离场计划都可不设）；
 * 生涯总账：每个人每一趟的输赢柱子。都只做显示和收集输入，数据由 Simulator 从赌桌状态整理。
 */

const fmt = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);

export interface VisitPlanDraft {
  stopWin?: number;
  stopLoss?: number;
  maxRounds?: number;
}

export interface EntryCandidate {
  personId: string;
  name: string;
  /** 策略名，或“你 · 手动” */
  tag: string;
  defaultBankroll: number;
  defaultPlan: VisitPlanDraft;
  /** 之前来过几次 */
  visits: number;
  /** 这个人正坐在别的桌：坐过来就是带着筹码换桌（如“从 2 号桌带 830 过来”） */
  switchFrom?: string;
}

/** 一趟离场计划的简短说明，如“赢 +200 走 · 最多 150 局”；什么都没设返回 null。 */
export function planText(plan: VisitPlanDraft): string | null {
  const parts: string[] = [];
  if (plan.stopWin != null) parts.push(`赢 +${fmt(plan.stopWin)} 走`);
  if (plan.stopLoss != null) parts.push(`输 −${fmt(plan.stopLoss)} 走`);
  if (plan.maxRounds != null) parts.push(`最多 ${fmt(plan.maxRounds)} 局`);
  return parts.length ? parts.join(" · ") : null;
}

const toText = (value: number | undefined) => (value == null ? "" : String(value));

export function EntryPanel({
  seatNumber,
  candidates,
  unit,
  minBankroll,
  editable,
  onSit,
  onSwitch,
  onClose,
  style,
  sheet,
}: {
  seatNumber: number;
  candidates: EntryCandidate[];
  /** 点数最小单位（规则层 pointUnit） */
  unit: number;
  /** 最少要带多少（规则层 minStake） */
  minBankroll: number;
  /** 只有两局之间才能入座 */
  editable: boolean;
  /** 返回 null 表示坐下了；否则返回不能坐的原因 */
  onSit: (personId: string, bankroll: number, plan: VisitPlanDraft) => string | null;
  /** 选中的人正坐在别的桌时：带着筹码换过来。返回不能换的原因，或 null */
  onSwitch: (personId: string) => string | null;
  onClose: () => void;
  style?: CSSProperties;
  sheet?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const first = candidates[0];
  const [personId, setPersonId] = useState(first?.personId ?? "");
  const [bankroll, setBankroll] = useState(toText(first?.defaultBankroll));
  const [stopWin, setStopWin] = useState(toText(first?.defaultPlan.stopWin));
  const [stopLoss, setStopLoss] = useState(toText(first?.defaultPlan.stopLoss));
  const [maxRounds, setMaxRounds] = useState(toText(first?.defaultPlan.maxRounds));
  const [error, setError] = useState<string | null>(null);

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

  const pick = (candidate: EntryCandidate) => {
    setPersonId(candidate.personId);
    setBankroll(toText(candidate.defaultBankroll));
    setStopWin(toText(candidate.defaultPlan.stopWin));
    setStopLoss(toText(candidate.defaultPlan.stopLoss));
    setMaxRounds(toText(candidate.defaultPlan.maxRounds));
    setError(null);
  };

  /** 空着就是不设；填了必须是正整数。 */
  const optional = (text: string, label: string): number | undefined | string => {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    const value = Number(trimmed);
    if (!Number.isInteger(value) || value < 1) return `${label}要填正整数，或者空着不设`;
    return value;
  };

  const selected = candidates.find((candidate) => candidate.personId === personId);

  const submit = () => {
    if (selected?.switchFrom) {
      setError(onSwitch(personId));
      return;
    }
    const amount = Number(bankroll.trim());
    if (!bankroll.trim() || !Number.isInteger(amount)) {
      setError("要先填这趟带多少钱");
      return;
    }
    if (amount < minBankroll || amount % unit !== 0) {
      setError(`带的钱要是 ${unit} 的倍数，至少 ${fmt(minBankroll)}（够下最小一注）`);
      return;
    }
    const fields = [
      optional(stopWin, "赢多少就走"),
      optional(stopLoss, "输多少就走"),
      optional(maxRounds, "玩多少局"),
    ];
    const bad = fields.find((value) => typeof value === "string");
    if (typeof bad === "string") {
      setError(bad);
      return;
    }
    const [win, loss, rounds] = fields as (number | undefined)[];
    const plan: VisitPlanDraft = {};
    if (win != null) plan.stopWin = win;
    if (loss != null) plan.stopLoss = loss;
    if (rounds != null) plan.maxRounds = rounds;
    setError(onSit(personId, amount, plan));
  };

  return (
    <div ref={ref} className={`pe-pop pe-entry ${sheet ? "pe-sheet" : ""}`} style={style} role="dialog" aria-label={`${seatNumber} 号座入座`}>
      {sheet && <span className="pe-sheet__grab" aria-hidden="true" />}
      <h4>
        <span>{String(seatNumber).padStart(2, "0")} 号座空着 · 谁来坐？</span>
      </h4>
      {!editable && <p className="pe-pop__lock">牌局进行中，这局结束后才能入座。</p>}
      {candidates.length === 0 ? (
        <p className="pe-pop__lock">常客都在桌上了。</p>
      ) : (
        <ul className="pe-pop__list" role="radiogroup" aria-label="入座的人">
          {candidates.map((candidate) => (
            <li key={candidate.personId}>
              <button
                type="button"
                role="radio"
                aria-checked={candidate.personId === personId}
                className={candidate.personId === personId ? "is-on" : ""}
                onClick={() => pick(candidate)}
              >
                <span className="pe-pop__who">
                  <Avatar name={candidate.name} size={20} />
                  {candidate.name}
                </span>
                <small>
                  {candidate.switchFrom ?? candidate.tag}
                  {!candidate.switchFrom && candidate.visits > 0 ? ` · 来过 ${candidate.visits} 次` : ""}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected?.switchFrom ? (
        <p className="pe-entry__hint">
          {selected.switchFrom}：还是这一趟，筹码、已玩局数和离场计划都跟着走，不用重新买入。
        </p>
      ) : (
      <>
      <div className="pe-entry__fields">
        <label className="pe-entry__must">
          <span>这趟带多少钱</span>
          <input
            type="number"
            min={minBankroll}
            step={unit}
            value={bankroll}
            onChange={(event) => setBankroll(event.target.value)}
            aria-label="这趟带多少钱"
          />
        </label>
        <label>
          <span>赢多少就走</span>
          <input type="number" min={1} placeholder="不设" value={stopWin} onChange={(event) => setStopWin(event.target.value)} aria-label="赢多少就走" />
        </label>
        <label>
          <span>输多少就走</span>
          <input type="number" min={1} placeholder="不设" value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} aria-label="输多少就走" />
        </label>
        <label>
          <span>玩多少局</span>
          <input type="number" min={1} placeholder="不设" value={maxRounds} onChange={(event) => setMaxRounds(event.target.value)} aria-label="玩多少局" />
        </label>
      </div>
      <p className="pe-entry__hint">后三项可以空着。设了就由牌桌照做：到线就离场，过了止损线不能补仓。</p>
      </>
      )}
      {error && <p className="pe-entry__error" role="alert">{error}</p>}
      <div className="pe-pop__acts">
        <button type="button" className="pe-btn" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="pe-btn pe-btn--primary"
          disabled={!editable || candidates.length === 0}
          onClick={submit}
        >
          {selected?.switchFrom ? "带筹码换过来" : "入座"}
        </button>
      </div>
    </div>
  );
}

export interface LedgerVisit {
  net: number;
  /** 还在桌上的这一趟 */
  ongoing: boolean;
  /** 柱子悬停说明 */
  title: string;
}

export interface LedgerRow {
  personId: string;
  name: string;
  /** 策略名或“手动” */
  tag: string;
  /** 正坐在哪张桌（如“2 号桌”）；不在桌上为 null */
  where: string | null;
  visits: LedgerVisit[];
  finishedVisits: number;
  winningVisits: number;
  lifetimeNet: number;
  lifetimeBuyIn: number;
}

/** 每行最多画最近这么多趟 */
const MAX_BARS = 40;

export function LifetimeLedger({ rows }: { rows: LedgerRow[] }) {
  const finished = rows.reduce((sum, row) => sum + row.finishedVisits, 0);
  const winning = rows.reduce((sum, row) => sum + row.winningVisits, 0);
  const total = rows.reduce((sum, row) => sum + row.lifetimeNet, 0);
  // 每行按这个人自己最大的一趟缩放：看的是一个人“多数小赢、偶尔大输”的形状。
  const scaleOf = (row: LedgerRow) =>
    Math.max(1, ...row.visits.slice(-MAX_BARS).map((visit) => Math.abs(visit.net)));

  return (
    <article className="pe-card-panel pe-life" aria-label="生涯总账">
      <div className="pe-card-panel__head">
        <span className="pe-label">生涯总账</span>
        <small className="pe-cap">每根柱子是一趟：向上赢着走，向下输着走，空心是还在桌上；柱高按本人最大的一趟缩放</small>
      </div>
      {rows.length === 0 ? (
        <p className="pe-cap">还没有人来过。</p>
      ) : (
        <>
          <p className="pe-life__sum">
            {rows.length} 人来过，走了 <b>{finished}</b> 趟，其中赢着走 <b className="is-win">{winning}</b> 趟
            {finished > 0 && <>（{Math.round((winning / finished) * 100)}%）</>}
            ；所有人生涯合计 <b className={total > 0 ? "is-win" : total < 0 ? "is-loss" : ""}>{formatSigned(total)}</b>
          </p>
          <ul className="pe-life__rows">
            {rows.map((row) => (
              <li key={row.personId}>
                <span className="pe-life__who">
                  <Avatar name={row.name} size={24} />
                  <span>
                    {row.name}
                    {row.where && <i>{row.where}</i>}
                    <small>{row.tag}</small>
                  </span>
                </span>
                <span className="pe-life__count">
                  {row.visits.length} 趟
                  <small>
                    赢着走 {row.winningVisits}/{row.finishedVisits}
                  </small>
                </span>
                <span className="pe-life__bars" aria-hidden="true">
                  {row.visits.slice(-MAX_BARS).map((visit, index) => (
                    <span key={index} className="pe-life__bar" title={visit.title}>
                      <i
                        className={`${visit.net >= 0 ? "is-up" : "is-down"} ${visit.ongoing ? "is-open" : ""}`}
                        style={{ height: `${Math.max(3, (Math.abs(visit.net) / scaleOf(row)) * 50)}%` }}
                      />
                    </span>
                  ))}
                </span>
                <b className={row.lifetimeNet > 0 ? "is-win" : row.lifetimeNet < 0 ? "is-loss" : ""}>
                  {formatSigned(row.lifetimeNet)}
                  <small>共投入 {fmt(row.lifetimeBuyIn)}</small>
                </b>
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
