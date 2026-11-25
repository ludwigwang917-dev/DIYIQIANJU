"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { MonteCarloResult } from "@/lib/core/monte-carlo";
import { getGame } from "@/lib/core/registry";
import { StrategyTextError, parseStrategyText, printStrategyText } from "@/lib/core/rules/formula";
import { previewRuleStrategy, type PreviewRow } from "@/lib/core/rules/preview";
import { encodeShare, SHARE_KEY } from "@/lib/core/rules/share";
import type { Expr, Rule, RuleBet, RuleStrategy } from "@/lib/core/rules/types";
import { validateRuleStrategy } from "@/lib/core/rules/validate";
import { PRESETS_AS_RULES, SUPERSTITION_TEMPLATES, blankStrategy } from "@/lib/games/niuniu/rule-templates";
import { ConditionEditor, ExprSlot, describeExpr, useVariables } from "./blocks";

/** The quick comparison: same seed for both, so the difference is the strategy, not the cards. */
const COMPARE = { runs: 300, maxRounds: 500, bankroll: 1000, seed: 20261125 };
const DRAFT_ID = "custom-draft";

/** `key` is the draft the result belongs to; a result for an older draft shows as "waiting". */
type CompareState = { key: string } & (
  | { status: "waiting" }
  | { status: "running" }
  | { status: "done"; mine: MonteCarloResult; flat: MonteCarloResult }
  | { status: "error"; message: string }
);

function runInWorker(request: Record<string, unknown>, onDone: (result: MonteCarloResult) => void, onError: (message: string) => void) {
  const worker = new Worker(new URL("../../../workers/monte-carlo.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event) => {
    if (event.data.type === "complete") {
      onDone(event.data.result);
      worker.terminate();
    }
    if (event.data.type === "error") {
      onError(event.data.message);
      worker.terminate();
    }
  };
  worker.onerror = (event) => {
    onError(event.message || "实验线程出错");
    worker.terminate();
  };
  worker.postMessage(request);
  return worker;
}

const points = (value: number) => Math.round(value).toLocaleString("en-US");
const signed = (value: number, digits = 0) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}`;

export function StrategyEditor({
  gameId,
  initial,
  savedId,
  note,
  onSave,
  onDelete,
  onClose,
}: {
  gameId: string;
  initial: RuleStrategy;
  /** Id in this browser's saved list, or null for a new strategy. */
  savedId: string | null;
  /** A line shown under the title (e.g. "来自分享链接"). */
  note?: string;
  onSave: (strategy: RuleStrategy, id: string | null) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const game = getGame(gameId);
  const fields = useMemo(() => game.paramFields?.() ?? [], [game]);
  const betNames = useMemo(() => fields.map((field) => ({ key: field.key, label: field.label })), [fields]);
  const variables = useVariables(gameId);
  const [draft, setDraft] = useState<RuleStrategy>(initial);
  const [view, setView] = useState<"blocks" | "text">("blocks");
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<string | null>(null);
  const [seed, setSeed] = useState(7);
  const [copied, setCopied] = useState<string | null>(null);
  const [compareState, setCompare] = useState<CompareState>({ key: "", status: "waiting" });
  const flatResult = useRef<MonteCarloResult | null>(null);

  const issues = useMemo(() => validateRuleStrategy(draft, gameId), [draft, gameId]);
  const valid = issues.length === 0;
  const draftKey = JSON.stringify(draft);
  const compare: CompareState = compareState.key === draftKey ? compareState : { key: draftKey, status: "waiting" };

  const preview = useMemo<{ rows: PreviewRow[] } | { error: string } | null>(() => {
    if (!valid) return null;
    try {
      return { rows: previewRuleStrategy(draft, { seed }) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    // draftKey stands for draft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, seed, valid]);

  // Re-run the 300-table comparison a moment after the last valid change.
  useEffect(() => {
    if (!valid) return;
    const workers: Worker[] = [];
    const key = draftKey;
    const timer = window.setTimeout(() => {
      setCompare({ key, status: "running" });
      let mine: MonteCarloResult | null = null;
      const finish = () => {
        if (mine && flatResult.current) setCompare({ key, status: "done", mine, flat: flatResult.current });
      };
      const fail = (message: string) => setCompare({ key, status: "error", message });
      workers.push(
        runInWorker(
          { ...COMPARE, strategyId: DRAFT_ID, rules: JSON.parse(draftKey) },
          (result) => {
            mine = result;
            finish();
          },
          fail,
        ),
      );
      if (!flatResult.current) {
        workers.push(
          runInWorker(
            { ...COMPARE, strategyId: "flat" },
            (result) => {
              flatResult.current = result;
              finish();
            },
            fail,
          ),
        );
      }
    }, 700);
    return () => {
      window.clearTimeout(timer);
      workers.forEach((worker) => worker.terminate());
    };
  }, [draftKey, valid]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setRule = (index: number, rule: Rule) =>
    setDraft((current) => ({ ...current, rules: current.rules.map((item, itemIndex) => (itemIndex === index ? rule : item)) }));
  const moveRule = (index: number, delta: number) =>
    setDraft((current) => {
      const rules = [...current.rules];
      const target = index + delta;
      if (target < 0 || target >= rules.length) return current;
      [rules[index], rules[target]] = [rules[target], rules[index]];
      return { ...current, rules };
    });

  const openText = () => {
    setText(printStrategyText(draft, betNames));
    setTextError(null);
    setView("text");
  };

  const editText = (value: string) => {
    setText(value);
    try {
      const parsed = parseStrategyText(value, betNames, draft);
      setDraft(parsed);
      setTextError(null);
    } catch (error) {
      setTextError(error instanceof StrategyTextError ? error.message : String(error));
    }
  };

  const loadTemplate = (key: string) => {
    if (!key) return;
    const [kind, id] = key.split(":");
    const source =
      kind === "blank"
        ? blankStrategy()
        : kind === "belief"
          ? SUPERSTITION_TEMPLATES.find((item) => item.id === id)?.strategy
          : PRESETS_AS_RULES[id];
    if (source) {
      setDraft(structuredClone(source));
      if (view === "text") setText(printStrategyText(source, betNames));
    }
  };

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${SHARE_KEY}=${encodeShare(draft)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied("分享链接已复制。对方打开后会先看到你的规则，自己决定要不要用。");
    } catch {
      window.prompt("复制这个链接发给别人：", url);
    }
  };

  const betEditor = (bet: RuleBet, onChange: (next: RuleBet) => void, prefix: string) => (
    <div className="pe-bet-row">
      {fields.map((field) => (
        <label key={field.key} className="pe-bet-row__field">
          <span>
            {field.label}
            <small>
              {field.min}–{field.max}
            </small>
          </span>
          <ExprSlot
            value={bet[field.key] ?? { n: field.defaultValue }}
            variables={variables}
            step={field.step}
            label={`${prefix}${field.label}`}
            onChange={(expr: Expr) => onChange({ ...bet, [field.key]: expr })}
          />
        </label>
      ))}
    </div>
  );

  const ruleLabel = (index: number) => (index < 0 ? "否则" : `规则 ${index + 1}`);
  const betText = (values: Record<string, number>) => fields.map((field) => values[field.key]).join(" / ");

  return (
    <div className="pe-modal-backdrop" role="presentation">
      <div className="pe-modal pe-editor" role="dialog" aria-modal="true" aria-label="策略编辑器">
        <button className="pe-modal__close" onClick={onClose} aria-label="关闭">
          ×
        </button>
        <header className="pe-editor__head">
          <span className="pe-eyebrow">策略编辑器 · 积木 + 公式</span>
          <div className="pe-editor__title">
            <input
              className="pe-editor__name"
              value={draft.name}
              maxLength={40}
              aria-label="策略名字"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <select className="pe-editor__template" value="" onChange={(event) => loadTemplate(event.target.value)} aria-label="从模板开始">
              <option value="">从模板开始…</option>
              <option value="blank:">空白策略</option>
              <optgroup label="赌桌上的说法（迷信策略）">
                {SUPERSTITION_TEMPLATES.map((item) => (
                  <option key={item.id} value={`belief:${item.id}`}>
                    {item.strategy.name} · “{item.belief}”
                  </option>
                ))}
              </optgroup>
              <optgroup label="照着预设改">
                {Object.entries(PRESETS_AS_RULES).map(([id, item]) => (
                  <option key={id} value={`preset:${id}`}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          {note && <p className="pe-editor__note">{note}</p>}
          <p className="pe-editor__hint">
            规则从上往下看，第一条满足的决定这一局怎么下；都不满足就按“否则”。能读到桌上任何人看得到的东西：自己和别人的筹码、连赢连输、荷官、往局亮出的牌、本局已经摆上桌的注；看不到本局的牌。
          </p>
        </header>

        <div className="pe-editor__body">
          <section className="pe-editor__rules" aria-label="规则">
            <div className="pe-seg pe-editor__views" role="tablist" aria-label="编辑方式">
              <button type="button" role="tab" aria-selected={view === "blocks"} className={view === "blocks" ? "is-on" : ""} onClick={() => setView("blocks")}>
                积木
              </button>
              <button type="button" role="tab" aria-selected={view === "text"} className={view === "text" ? "is-on" : ""} onClick={openText}>
                整段文字
              </button>
            </div>

            {view === "blocks" ? (
              <>
                {draft.rules.map((rule, index) => (
                  <article className="pe-rule" key={index}>
                    <header>
                      <b>规则 {index + 1}</b>
                      <span>满足下面的条件时</span>
                      <span className="pe-rule__tools">
                        <button type="button" className="pe-icon-btn" disabled={index === 0} onClick={() => moveRule(index, -1)} aria-label={`规则 ${index + 1} 上移`}>
                          ↑
                        </button>
                        <button
                          type="button"
                          className="pe-icon-btn"
                          disabled={index === draft.rules.length - 1}
                          onClick={() => moveRule(index, 1)}
                          aria-label={`规则 ${index + 1} 下移`}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="pe-icon-btn"
                          onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, itemIndex) => itemIndex !== index) })}
                          aria-label={`删除规则 ${index + 1}`}
                        >
                          ×
                        </button>
                      </span>
                    </header>
                    <ConditionEditor
                      when={rule.when}
                      variables={variables}
                      labelPrefix={`规则 ${index + 1} `}
                      onChange={(when) => setRule(index, { ...rule, when })}
                    />
                    <div className="pe-rule__then">
                      <span className="pe-rule__kw">就下</span>
                      {betEditor(rule.bet, (bet) => setRule(index, { ...rule, bet }), `规则 ${index + 1} `)}
                    </div>
                  </article>
                ))}
                <button
                  type="button"
                  className="pe-btn pe-editor__add"
                  disabled={draft.rules.length >= 20}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      rules: [
                        ...draft.rules,
                        {
                          when: { f: "ge", a: [{ v: "me.lossStreak" }, { n: 3 }] },
                          bet: Object.fromEntries(fields.map((field) => [field.key, { n: field.defaultValue }])),
                        },
                      ],
                    })
                  }
                >
                  ＋ 加一条规则
                </button>
                <article className="pe-rule pe-rule--otherwise">
                  <header>
                    <b>否则</b>
                    <span>上面的规则都不满足时</span>
                  </header>
                  <div className="pe-rule__then">
                    <span className="pe-rule__kw">就下</span>
                    {betEditor(draft.otherwise, (otherwise) => setDraft({ ...draft, otherwise }), "否则 ")}
                  </div>
                </article>
              </>
            ) : (
              <div className="pe-editor__text">
                <textarea value={text} spellCheck={false} rows={Math.max(6, text.split("\n").length + 2)} onChange={(event) => editText(event.target.value)} aria-label="整段策略文字" />
                <p className={textError ? "pe-editor__err" : "pe-cap"}>
                  {textError ??
                    "一行一条：当 条件 时：前注 = …，后注 = …；最后一行写 否则：…。函数：如果、最小、最大、幂、取整、为空、计数、求和、平均、最大值、最小值、存在。"}
                </p>
              </div>
            )}

            {issues.length > 0 && (
              <ul className="pe-editor__issues" aria-live="polite">
                {issues.map((issue, index) => (
                  <li key={index}>
                    <b>{issue.where}</b>
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside className="pe-editor__side">
            <section className="pe-compare" aria-label="300 桌对比" aria-live="polite">
              <h3>
                跑 {COMPARE.runs} 桌对比
                <small>
                  每桌带 {points(COMPARE.bankroll)}、最多 {COMPARE.maxRounds} 局，和平注用同一组牌
                </small>
              </h3>
              {compare.status === "done" ? (
                <table>
                  <thead>
                    <tr>
                      <th />
                      <th>{draft.name || "你的策略"}</th>
                      <th>平注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["输到离场", (r: MonteCarloResult) => `${(r.bankruptcyRate * 100).toFixed(1)}%`],
                      ["中位离场", (r: MonteCarloResult) => (r.medianBustRound == null ? `>${COMPARE.maxRounds} 局` : `第 ${r.medianBustRound} 局`)],
                      ["平均剩下", (r: MonteCarloResult) => points(r.averageEndingBankroll)],
                      ["平均每桌投注", (r: MonteCarloResult) => points(r.averageWagered)],
                    ].map(([label, format]) => (
                      <tr key={label as string}>
                        <th>{label as string}</th>
                        <td>{(format as (r: MonteCarloResult) => string)(compare.mine)}</td>
                        <td>{(format as (r: MonteCarloResult) => string)(compare.flat)}</td>
                      </tr>
                    ))}
                    <tr className="pe-compare__key">
                      <th>每投注 100 点</th>
                      <td className={compare.mine.netPerPointWagered < 0 ? "is-loss" : "is-win"}>{signed(compare.mine.netPerPointWagered * 100, 2)}</td>
                      <td className={compare.flat.netPerPointWagered < 0 ? "is-loss" : "is-win"}>{signed(compare.flat.netPerPointWagered * 100, 2)}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p className="pe-compare__wait">
                  {compare.status === "error"
                    ? `没算出来：${compare.message}`
                    : !valid
                      ? "先把左边标红的地方改好。"
                      : compare.status === "running"
                        ? "正在后台跑……"
                        : "改完停一下，就会自动重跑。"}
                </p>
              )}
              <p className="pe-cap">
                理论上每投注 100 点长期要输 1.77–2.31 点。规则怎么写，都只能改变什么时候下多少、多久输光，改不了这一行。只跑 300 桌，有一两点的上下浮动。
              </p>
            </section>

            <section className="pe-preview" aria-label="前 20 局预览">
              <h3>
                前 20 局预览
                <button type="button" className="pe-link-btn" onClick={() => setSeed((value) => value + 1)}>
                  换一副牌
                </button>
              </h3>
              <p className="pe-cap">你坐 1 号座，旁边坐着平注和马丁格尔两位常客。每一局都是真的发牌、真的结算。</p>
              {preview && "rows" in preview ? (
                <div className="pe-preview__scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>局</th>
                        <th>用的</th>
                        <th>前/后注</th>
                        <th>庄 · 我</th>
                        <th>输赢</th>
                        <th>余额</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row) => {
                        const detail = row.record?.detail as
                          | { dealer?: { label?: string }; seats?: { seatIndex: number; label?: string }[] }
                          | null
                          | undefined;
                        const mine = detail?.seats?.find((item) => item.seatIndex === 0);
                        const notes = [
                          ...(row.decision?.issues ?? []),
                          row.left === "insufficient_funds" ? "钱不够下这一注，离场" : row.left === "bankrupt" ? "输光离场" : null,
                        ].filter(Boolean);
                        return (
                          <Fragment key={row.round}>
                            <tr className={notes.length ? "has-note" : ""}>
                              <td>{row.round}</td>
                              <td>{row.decision ? ruleLabel(row.decision.ruleIndex) : "—"}</td>
                              <td>{row.decision ? betText(row.decision.values) : "—"}</td>
                              <td>{mine ? `${detail?.dealer?.label ?? "?"} · ${mine.label}` : "—"}</td>
                              <td className={row.delta > 0 ? "is-win" : row.delta < 0 ? "is-loss" : ""}>{row.outcome ? signed(row.delta) : "—"}</td>
                              <td>{points(row.bankrollAfter)}</td>
                            </tr>
                            {notes.length > 0 && (
                              <tr className="pe-preview__noterow">
                                <td colSpan={6}>{notes.join("；")}</td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="pe-compare__wait">{preview && "error" in preview ? `预览出错：${preview.error}` : "规则有问题，改好后显示预览。"}</p>
              )}
              {valid && draft.rules.length > 0 && (
                <p className="pe-cap pe-preview__legend">
                  {draft.rules.map((rule, index) => `规则 ${index + 1}：${describeWhen(rule.when, variables)}`).join("　")}
                </p>
              )}
            </section>
          </aside>
        </div>

        <footer className="pe-editor__foot">
          {copied && <span className="pe-cap pe-editor__copied">{copied}</span>}
          <span className="pe-editor__spacer" />
          {onDelete && savedId && (
            <button
              type="button"
              className="pe-btn"
              onClick={() => {
                if (window.confirm(`从这个浏览器里删掉「${draft.name}」？`)) onDelete();
              }}
            >
              删除
            </button>
          )}
          <button type="button" className="pe-btn" disabled={!valid} onClick={share}>
            复制分享链接
          </button>
          {savedId && (
            <button type="button" className="pe-btn" disabled={!valid} onClick={() => onSave(draft, null)}>
              另存为新策略
            </button>
          )}
          <button type="button" className="pe-btn pe-btn--primary" disabled={!valid} onClick={() => onSave(draft, savedId)}>
            {savedId ? "保存修改" : "保存到我的策略"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function describeWhen(when: Expr, variables: ReturnType<typeof useVariables>): string {
  if ("b" in when && when.b) return "总是";
  if ("f" in when && ["ge", "gt", "le", "lt", "eq", "ne"].includes(when.f)) {
    const symbol = { ge: "≥", gt: ">", le: "≤", lt: "<", eq: "=", ne: "≠" }[when.f as "ge"];
    const [left, right] = when.a;
    // An enum compared with one of its values: show the value's Chinese label (win → 赢).
    const field = "v" in left ? variables.byPath.get(left.v) : undefined;
    const option = "s" in right ? field?.values?.find((item) => item.value === right.s) : undefined;
    return `${describeExpr(left, variables)} ${symbol} ${option?.label ?? describeExpr(right, variables)}`;
  }
  if ("f" in when && (when.f === "and" || when.f === "or")) {
    return `${describeWhen(when.a[0], variables)} ${when.f === "and" ? "且" : "或"} ${describeWhen(when.a[1], variables)}`;
  }
  return describeExpr(when, variables);
}
