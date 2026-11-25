"use client";

import { useSyncExternalStore } from "react";
import type { StrategyInput, StrategyModule } from "@/lib/core/game-module";
import { getGame } from "@/lib/core/registry";
import type { RuleDecision, RuleStrategyModule } from "@/lib/core/rules/compile";
import { traceRuleDecision, type ConditionCheck, type RuleTrace } from "@/lib/core/rules/trace";
import type { Expr, Value } from "@/lib/core/rules/types";
import type { TableState } from "@/lib/core/types";
import { describeExpr, type Variables } from "./blocks";

/**
 * 牌桌上“看着程序按你的策略下注”：托管座位用编辑器里搭的策略下注时，把这一注的决定和理由
 * 记下来，铭牌上方显示气泡，旁边列出执行记录。只是显示，不影响下注本身。
 */

export interface StrategyNote {
  visitId: string;
  name: string;
  strategyId: string;
  strategyName: string;
  round: number;
  decision: RuleDecision;
  traces: RuleTrace[];
  fields: { key: string; label: string }[];
}

const NOTES_PER_VISIT = 12;
const store = {
  byVisit: new Map<string, StrategyNote[]>(),
  version: 0,
  listeners: new Set<() => void>(),
};

function isRuleModule(strategy: StrategyModule): strategy is RuleStrategyModule {
  return "explain" in strategy && "strategy" in strategy;
}

/** Pass as AutoPlayOptions.onDecide. Ignores presets and the editor's own preview. */
export function recordStrategyDecision(event: {
  table: TableState;
  seatIndex: number;
  strategy: StrategyModule;
  input: StrategyInput;
}) {
  const { table, seatIndex, strategy, input } = event;
  if (!isRuleModule(strategy) || strategy.id === "custom-preview" || strategy.id === "custom-draft") return;
  const seat = table.seats[seatIndex];
  if (!seat) return;
  const fields = (getGame(table.gameId).paramFields?.() ?? []).map((field) => ({ key: field.key, label: field.label }));
  const note: StrategyNote = {
    visitId: seat.visitId,
    name: seat.name,
    strategyId: strategy.id,
    strategyName: strategy.name,
    round: input.round,
    decision: strategy.explain(input),
    traces: traceRuleDecision(strategy.strategy, input),
    fields,
  };
  // The same seat may decide twice in one round (before and after a rebuy): keep the last.
  const list = (store.byVisit.get(seat.visitId) ?? []).filter((item) => item.round !== note.round);
  store.byVisit.set(seat.visitId, [...list, note].slice(-NOTES_PER_VISIT));
  store.version += 1;
  store.listeners.forEach((listener) => listener());
}

export function forgetStrategyNotes() {
  store.byVisit.clear();
  store.version += 1;
  store.listeners.forEach((listener) => listener());
}

/** Re-render when a new decision is recorded. */
export function useStrategyNotes() {
  useSyncExternalStore(
    (listener) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    () => store.version,
    () => 0,
  );
  return {
    latest: (visitId: string) => store.byVisit.get(visitId)?.at(-1) ?? null,
    all: (visitId: string) => store.byVisit.get(visitId) ?? [],
  };
}

/* ---------- 文字 ---------- */

const SYMBOL: Record<string, string> = { gt: ">", ge: "≥", lt: "<", le: "≤", eq: "=", ne: "≠" };

function label(expr: Expr | undefined, variables: Variables) {
  if (!expr) return "";
  const text = describeExpr(expr, variables);
  return text.length > 18 ? "公式" : text;
}

function valueText(value: Value | undefined, expr: Expr | undefined, variables: Variables) {
  if (value == null) return "无";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString("en-US") : String(Number(value.toFixed(2)));
  const field = expr && "v" in expr ? variables.byPath.get(expr.v) : undefined;
  return field?.values?.find((option) => option.value === value)?.label ?? value;
}

/**
 * A condition that held: "我的连输 3 ≥ 3". One that did not: "我的连输 1，要 ≥ 2".
 * An option compared with one of its values reads as words instead of symbols:
 * "我的上一局：赢", "庄家对全桌在连：连输（要连赢）", "…：连输（不是连赢）".
 * The right side shows its value only when it is not a plain literal.
 */
export function checkText(check: ConditionCheck, variables: Variables) {
  if (!check.op) return check.ok ? label(check.expr, variables) : `${label(check.expr, variables)} 不成立`;
  const enumField = check.left && "v" in check.left ? variables.byPath.get(check.left.v) : undefined;
  if (enumField?.type === "enum" && check.right && "s" in check.right && (check.op === "eq" || check.op === "ne")) {
    const actual = valueText(check.leftValue, check.left, variables);
    const wanted = valueText(check.rightValue, check.left, variables);
    const head = `${enumField.label}：${actual}`;
    if (check.op === "eq") return check.ok ? head : `${head}（要${wanted}）`;
    return check.ok ? `${head}（不是${wanted}）` : `${head}（要不是${wanted}）`;
  }
  const literal = check.right && ("n" in check.right || "s" in check.right || "b" in check.right);
  const field = check.left && "v" in check.left ? check.left : undefined;
  const right = literal
    ? valueText(check.rightValue, field, variables)
    : `${label(check.right, variables)} ${valueText(check.rightValue, check.right, variables)}`;
  const left = `${label(check.left, variables)} ${valueText(check.leftValue, check.left, variables)}`;
  return check.ok ? `${left} ${SYMBOL[check.op]} ${right}` : `${left}，要 ${SYMBOL[check.op]} ${right}`;
}

/** Why this bet, in one line. */
export function reasonText(note: StrategyNote, variables: Variables) {
  const { ruleIndex } = note.decision;
  if (ruleIndex >= 0) {
    const trace = note.traces.find((item) => item.ruleIndex === ruleIndex);
    if (!trace) return "";
    const shown = trace.joiner === "or" ? trace.checks.filter((check) => check.ok).slice(0, 1) : trace.checks.slice(0, 2);
    return shown.map((check) => checkText(check, variables)).join(" 且 ") + (trace.checks.length > shown.length && trace.joiner === "and" ? " …" : "");
  }
  if (!note.traces.length) return "只有一种下法";
  const first = note.traces[0];
  const failed = first.checks.find((check) => !check.ok) ?? first.checks[0];
  return failed ? `规则 1 没满足，${checkText(failed, variables)}` : "规则都没满足";
}

export function betText(note: StrategyNote) {
  return note.fields.map((field) => `${field.label} ${note.decision.values[field.key]}`).join(" · ");
}

export function ruleName(note: StrategyNote) {
  return note.decision.ruleIndex < 0 ? "否则" : `规则 ${note.decision.ruleIndex + 1}`;
}

/* ---------- 牌桌上的气泡 ---------- */

/** Two lines: "策略 · 规则 2 → 20 / 20" and the reason. Adjustments show as ⚠ (details on hover). */
export function StrategyBubble({ note, variables, compact = false }: { note: StrategyNote; variables: Variables; compact?: boolean }) {
  const issues = note.decision.issues;
  const bet = note.fields.map((field) => note.decision.values[field.key]).join(" / ");
  return (
    <div
      className={`pe-stratnote ${compact ? "pe-stratnote--m" : ""}`}
      role="status"
      aria-label={`${note.name}按「${note.strategyName}」${ruleName(note)}下注：${betText(note)}。${reasonText(note, variables)}`}
      title={[`${ruleName(note)}：${reasonText(note, variables)}`, `下注：${betText(note)}`, ...issues].join("\n")}
    >
      <b>
        <span>
          {note.strategyName} · {ruleName(note)}
        </span>
        <em>→ {bet}</em>
        {issues.length > 0 && <i>⚠</i>}
      </b>
      <span className="pe-stratnote__why">{reasonText(note, variables)}</span>
    </div>
  );
}

/* ---------- 执行记录 ---------- */

export function StrategyLog({ notes, variables }: { notes: StrategyNote[]; variables: Variables }) {
  return (
    <article className="pe-panel pe-stratlog" aria-label="策略执行记录">
      <header className="pe-panel__head">
        <h3>策略执行记录</h3>
        <span className="pe-panel__aside">托管座位用你搭的策略时，每一注都写出理由</span>
      </header>
      {notes.length ? (
        <ol>
          {notes.map((note) => (
            <li key={`${note.visitId}-${note.round}`}>
              <span className="pe-stratlog__round">第 {note.round} 局</span>
              <span className="pe-stratlog__who">
                {note.name}
                <small>
                  {note.strategyName} · {ruleName(note)}
                </small>
              </span>
              <span className="pe-stratlog__why">
                {reasonText(note, variables)}
                {note.decision.issues.length > 0 && <small>⚠ {note.decision.issues.join("；")}</small>}
              </span>
              <b>{betText(note)}</b>
            </li>
          ))}
        </ol>
      ) : (
        <p className="pe-cap">点任意赌客的铭牌，在“我的策略”里选一个让他托管，这里就会逐局写出他为什么这样下。</p>
      )}
    </article>
  );
}
