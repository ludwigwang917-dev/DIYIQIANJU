"use client";

import { useMemo, useState } from "react";
import type { ObservationField } from "@/lib/core/game-module";
import { observationCatalog } from "@/lib/core/observe";
import { FormulaError, parseFormula, printFormula } from "@/lib/core/rules/formula";
import type { Expr, FnName } from "@/lib/core/rules/types";
import { STAT_SNIPPETS } from "@/lib/games/niuniu/rule-templates";

/* ---------- variables the picker offers ---------- */

const GROUP_LABEL: Partial<Record<ObservationField["group"], string>> = {
  me: "我",
  dealer: "荷官与庄家",
  table: "全桌",
};

/** Scalar variables (no lists) grouped for the picker, plus a lookup by path. */
export function useVariables(gameId: string) {
  return useMemo(() => {
    const fields = observationCatalog(gameId).filter((field) => !field.path.includes("[]") && GROUP_LABEL[field.group]);
    const byPath = new Map(fields.map((field) => [field.path, field]));
    const groups = (Object.keys(GROUP_LABEL) as ObservationField["group"][]).map((group) => ({
      group,
      label: GROUP_LABEL[group]!,
      fields: fields.filter((field) => field.group === group),
    }));
    return { groups, byPath };
  }, [gameId]);
}

export type Variables = ReturnType<typeof useVariables>;

const sameExpr = (a: Expr, b: Expr) => JSON.stringify(a) === JSON.stringify(b);

function snippetIndex(expr: Expr) {
  return "agg" in expr ? STAT_SNIPPETS.findIndex((item) => sameExpr(item.expr, expr)) : -1;
}

/** Human-readable text for an expression: Chinese labels for plain variables and statistics. */
export function describeExpr(expr: Expr, variables: Variables): string {
  if ("v" in expr) return variables.byPath.get(expr.v)?.label ?? expr.v;
  if ("n" in expr) return String(expr.n);
  const stat = snippetIndex(expr);
  if (stat >= 0) return STAT_SNIPPETS[stat].label;
  if ("s" in expr) return expr.s;
  return printFormula(expr);
}

type Mode = "num" | "var" | "stat" | "option" | "formula";

function modeOf(expr: Expr, variables: Variables, options?: { value: string; label: string }[]): Mode {
  if ("n" in expr) return "num";
  if ("v" in expr && variables.byPath.has(expr.v)) return "var";
  if (snippetIndex(expr) >= 0) return "stat";
  if ("s" in expr && options?.some((option) => option.value === expr.s)) return "option";
  return "formula";
}

/**
 * One value in a block: a number, a variable, a ready-made statistic, one of an enum's options,
 * or any formula. All five edit the same expression tree.
 */
export function ExprSlot({
  value,
  onChange,
  variables,
  options,
  step = 1,
  label,
}: {
  value: Expr;
  onChange: (next: Expr) => void;
  variables: Variables;
  /** When the other side of a comparison is an enum, its possible values. */
  options?: { value: string; label: string }[];
  step?: number;
  label: string;
}) {
  // Once someone chooses 公式, stay there even if what they type is a plain number.
  const [preferFormula, setPreferFormula] = useState(false);
  const mode = preferFormula ? "formula" : modeOf(value, variables, options);
  const printed = printFormula(value);
  const [text, setText] = useState(printed);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState(printed);

  // Keep the formula box in step with changes made elsewhere (templates, the text view), but
  // leave what the person is typing alone when it already means the same thing.
  if (seen !== printed) {
    setSeen(printed);
    let current: Expr | null = null;
    try {
      current = parseFormula(text);
    } catch {
      current = null;
    }
    if (!current || !sameExpr(current, value)) {
      setText(printed);
      setError(null);
    }
  }

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setPreferFormula(next === "formula");
    if (next === "num") onChange({ n: "n" in value ? value.n : step === 10 ? 10 : 0 });
    if (next === "var") onChange({ v: variables.groups[0].fields[0].path });
    if (next === "stat") onChange(STAT_SNIPPETS[0].expr);
    if (next === "option" && options?.length) onChange({ s: options[0].value });
    if (next === "formula") {
      setText(printed);
      setError(null);
    }
  };

  return (
    <span className={`pe-slot pe-slot--${mode}`}>
      <select
        className="pe-slot__mode"
        value={mode}
        onChange={(event) => switchMode(event.target.value as Mode)}
        aria-label={`${label}：类型`}
      >
        <option value="num">数字</option>
        <option value="var">变量</option>
        <option value="stat">统计</option>
        {options?.length ? <option value="option">选项</option> : null}
        <option value="formula">公式</option>
      </select>
      {mode === "num" && "n" in value && (
        <input
          type="number"
          className="pe-slot__num"
          value={value.n}
          step={step}
          aria-label={label}
          onChange={(event) => {
            const number = Number(event.target.value);
            if (event.target.value !== "" && Number.isFinite(number)) onChange({ n: number });
          }}
        />
      )}
      {mode === "var" && "v" in value && (
        <select className="pe-slot__pick" value={value.v} aria-label={label} onChange={(event) => onChange({ v: event.target.value })}>
          {variables.groups.map((group) => (
            <optgroup key={group.group} label={group.label}>
              {group.fields.map((field) => (
                <option key={field.path} value={field.path} title={field.path}>
                  {field.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
      {mode === "stat" && (
        <select
          className="pe-slot__pick"
          value={snippetIndex(value)}
          aria-label={label}
          onChange={(event) => onChange(STAT_SNIPPETS[Number(event.target.value)].expr)}
        >
          {STAT_SNIPPETS.map((item, index) => (
            <option key={item.label} value={index}>
              {item.label}
            </option>
          ))}
        </select>
      )}
      {mode === "option" && "s" in value && options && (
        <select className="pe-slot__pick" value={value.s} aria-label={label} onChange={(event) => onChange({ s: event.target.value })}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      {mode === "formula" && (
        <span className="pe-slot__formula">
          <input
            type="text"
            value={text}
            spellCheck={false}
            aria-label={`${label}（公式）`}
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              setText(event.target.value);
              try {
                onChange(parseFormula(event.target.value));
                setError(null);
              } catch (caught) {
                setError(caught instanceof FormulaError ? caught.message : String(caught));
              }
            }}
          />
          {error && <small className="pe-slot__error">{error}</small>}
        </span>
      )}
    </span>
  );
}

/* ---------- conditions: rows joined by 且 / 或 ---------- */

export const COMPARISONS: { fn: FnName; label: string }[] = [
  { fn: "ge", label: "≥" },
  { fn: "gt", label: ">" },
  { fn: "le", label: "≤" },
  { fn: "lt", label: "<" },
  { fn: "eq", label: "=" },
  { fn: "ne", label: "≠" },
];
const COMPARISON_FNS = new Set(COMPARISONS.map((item) => item.fn));

type Row = { kind: "cmp"; left: Expr; op: FnName; right: Expr } | { kind: "expr"; expr: Expr };

function chain(expr: Expr, fn: "and" | "or"): Expr[] {
  return "f" in expr && expr.f === fn ? [...chain(expr.a[0], fn), ...chain(expr.a[1], fn)] : [expr];
}

function toRows(when: Expr): { joiner: "and" | "or"; rows: Row[] } {
  if ("b" in when && when.b) return { joiner: "and", rows: [] };
  const joiner = "f" in when && when.f === "or" ? "or" : "and";
  const items = "f" in when && (when.f === "and" || when.f === "or") ? chain(when, when.f) : [when];
  return {
    joiner,
    rows: items.map((item): Row =>
      "f" in item && COMPARISON_FNS.has(item.f) ? { kind: "cmp", left: item.a[0], op: item.f, right: item.a[1] } : { kind: "expr", expr: item },
    ),
  };
}

function fromRows(joiner: "and" | "or", rows: Row[]): Expr {
  const items = rows.map((row): Expr => (row.kind === "cmp" ? { f: row.op, a: [row.left, row.right] } : row.expr));
  if (!items.length) return { b: true };
  return items.slice(1).reduce((acc, item) => ({ f: joiner, a: [acc, item] }), items[0]);
}

export function ConditionEditor({
  when,
  onChange,
  variables,
  labelPrefix,
}: {
  when: Expr;
  onChange: (next: Expr) => void;
  variables: Variables;
  labelPrefix: string;
}) {
  const { joiner, rows } = toRows(when);
  const update = (nextRows: Row[], nextJoiner = joiner) => onChange(fromRows(nextJoiner, nextRows));
  const setRow = (index: number, row: Row) => update(rows.map((item, itemIndex) => (itemIndex === index ? row : item)));

  return (
    <div className="pe-cond">
      {rows.length > 1 && (
        <div className="pe-seg pe-cond__join" role="radiogroup" aria-label={`${labelPrefix}：条件之间`}>
          <button type="button" className={joiner === "and" ? "is-on" : ""} onClick={() => update(rows, "and")}>
            全部满足
          </button>
          <button type="button" className={joiner === "or" ? "is-on" : ""} onClick={() => update(rows, "or")}>
            满足任一
          </button>
        </div>
      )}
      {rows.length === 0 && <p className="pe-cond__always">每一局都满足（没有条件）</p>}
      {rows.map((row, index) => {
        const enumField = row.kind === "cmp" && "v" in row.left ? variables.byPath.get(row.left.v) : undefined;
        const options = enumField?.type === "enum" ? enumField.values : undefined;
        return (
          <div className="pe-cond__row" key={index}>
            {index > 0 && <span className="pe-cond__glue">{joiner === "and" ? "且" : "或"}</span>}
            {row.kind === "cmp" ? (
              <>
                <ExprSlot
                  value={row.left}
                  variables={variables}
                  label={`${labelPrefix}条件 ${index + 1} 左边`}
                  onChange={(left) => {
                    const field = "v" in left ? variables.byPath.get(left.v) : undefined;
                    // Picking an enum variable: offer its first option on the right instead of a number.
                    const right =
                      field?.type === "enum" && field.values && !("s" in row.right) ? { s: field.values[0].value } : row.right;
                    setRow(index, { ...row, left, right, op: field?.type === "enum" && !["eq", "ne"].includes(row.op) ? "eq" : row.op });
                  }}
                />
                <select
                  className="pe-cond__op"
                  value={row.op}
                  aria-label={`${labelPrefix}条件 ${index + 1} 比较`}
                  onChange={(event) => setRow(index, { ...row, op: event.target.value as FnName })}
                >
                  {COMPARISONS.filter((item) => !options || item.fn === "eq" || item.fn === "ne").map((item) => (
                    <option key={item.fn} value={item.fn}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <ExprSlot
                  value={row.right}
                  variables={variables}
                  options={options}
                  label={`${labelPrefix}条件 ${index + 1} 右边`}
                  onChange={(right) => setRow(index, { ...row, right })}
                />
              </>
            ) : (
              <ExprSlot
                value={row.expr}
                variables={variables}
                label={`${labelPrefix}条件 ${index + 1}`}
                onChange={(expr) => setRow(index, { kind: "expr", expr })}
              />
            )}
            <button
              type="button"
              className="pe-icon-btn"
              aria-label={`删除${labelPrefix}条件 ${index + 1}`}
              onClick={() => update(rows.filter((_, itemIndex) => itemIndex !== index))}
            >
              ×
            </button>
          </div>
        );
      })}
      <div className="pe-cond__add">
        <button
          type="button"
          className="pe-link-btn"
          onClick={() => update([...rows, { kind: "cmp", left: { v: "me.lossStreak" }, op: "ge", right: { n: 3 } }])}
        >
          ＋ 加一个条件
        </button>
        <button
          type="button"
          className="pe-link-btn"
          onClick={() => update([...rows, { kind: "expr", expr: parseFormula("计数(history, 10, it.dealerDelta > 0) >= 6") }])}
        >
          ＋ 用公式写条件
        </button>
      </div>
    </div>
  );
}
