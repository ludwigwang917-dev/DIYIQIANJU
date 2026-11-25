"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { lifetimeLedgers } from "@/lib/core/lifetime";
import type { TableState } from "@/lib/core/types";
import { NICKNAME_MAX, type LeaderboardData } from "@/lib/leaderboard";
import { formatSigned } from "./plaque";

/**
 * 全站排行榜（2026-11-25）。只上传真人“你”的每一趟；常客不上传。
 * 没有账号：浏览器本地存一个随机 deviceId 和昵称。没设昵称就不上传，设了以后补传本页已走完的趟。
 */

const DEVICE_KEY = "pe-device-id";
const NICK_KEY = "pe-nickname";
/**
 * 每次打开页面一个新值：visitId 只在一次页面里唯一，拼上它才能跨页面去重。
 * 第一次上传时才生成：Cloudflare Worker 不允许在模块顶层（全局作用域）生成随机数，
 * 生产构建会在启动时加载这个模块，顶层调用会让整页服务端渲染失败（2026-11-25 线上实测）。
 */
let pageSession: string | null = null;
function pageSessionId() {
  pageSession ??= randomId();
  return pageSession;
}

function randomId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function readLocal(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 隐私模式等存不了：这次页面里照样能用 */
  }
}

function deviceId() {
  let id = readLocal(DEVICE_KEY);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = randomId();
    writeLocal(DEVICE_KEY, id);
  }
  return id;
}

/** 跟踪“你”每一趟用过的玩法，走完一趟就上传。 */
export function useLeaderboardSync(casino: TableState[], personId: string) {
  const [nickname, setNicknameState] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const controlsRef = useRef(new Map<string, Set<string>>());
  const sentRef = useRef(new Set<string>());

  useEffect(() => {
    // 只在浏览器里读本地存储（服务端渲染时没有 window）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNicknameState(readLocal(NICK_KEY));
  }, []);

  // 记下这一趟坐着时的玩法（手动 / 哪个策略），中途换过就算“混合”。
  // 声明在上传之前，同一次提交里先记玩法再上传。
  useEffect(() => {
    for (const table of casino) {
      for (const seat of table.seats) {
        if (!seat || seat.personId !== personId) continue;
        const label =
          seat.control.kind === "human"
            ? "manual"
            : seat.control.strategyId;
        const set = controlsRef.current.get(seat.visitId) ?? new Set<string>();
        set.add(label);
        controlsRef.current.set(seat.visitId, set);
      }
    }
  }, [casino, personId]);

  const ledger = lifetimeLedgers(casino).find((row) => row.personId === personId);
  const finished = (ledger?.visits ?? []).filter((visit) => visit.reason !== null && visit.reason !== "switch_table");
  // 失败的那趟会从 sentRef 里删掉，下一次有新的一趟走完或改昵称时重试。
  const pendingKey = finished.map((visit) => visit.visitId).join(",");

  useEffect(() => {
    if (!nickname || !pendingKey) return;
    const id = deviceId();
    const todo = finished.filter((visit) => !sentRef.current.has(visit.visitId));
    for (const visit of todo) {
      sentRef.current.add(visit.visitId);
      const used = controlsRef.current.get(visit.visitId);
      const strategy = !used || used.size === 0 ? "manual" : used.size === 1 ? [...used][0] : "mixed";
      fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deviceId: id,
          clientKey: `${pageSessionId()}:${visit.visitId}`,
          strategy,
          buyIn: visit.buyIn,
          cashOut: visit.cashOut,
          rounds: visit.rounds,
          buyIns: visit.buyIns,
          reason: visit.reason,
        }),
      })
        .then((response) => {
          if (!response.ok) sentRef.current.delete(visit.visitId);
          else setVersion((v) => v + 1);
        })
        .catch(() => sentRef.current.delete(visit.visitId));
    }
    // finished 每次渲染都是新数组；用 pendingKey 判断是否有新的一趟。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nickname, pendingKey]);

  const saveNickname = useCallback(async (value: string): Promise<string | null> => {
    const response = await fetch("/api/players", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: deviceId(), nickname: value }),
    }).catch(() => null);
    if (!response) return "网络不通，稍后再试";
    const data = (await response.json().catch(() => ({}))) as { nickname?: string; error?: string };
    if (!response.ok || !data.nickname) return data.error ?? "没存上";
    writeLocal(NICK_KEY, data.nickname);
    setNicknameState(data.nickname);
    setVersion((v) => v + 1);
    return null;
  }, []);

  return { nickname, saveNickname, version, unsent: nickname ? 0 : finished.length };
}

type Sync = ReturnType<typeof useLeaderboardSync>;

const REASON_LABEL: Record<string, string> = {
  bankrupt: "输光",
  insufficient_funds: "钱不够下注",
  left: "主动离席",
  stop_win: "赢够了走",
  stop_loss: "到止损线",
  time_up: "玩够局数",
};

function tone(n: number) {
  return n > 0 ? "is-win" : n < 0 ? "is-loss" : "";
}

function pct(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

export function Leaderboard({ sync, strategyName }: { sync: Sync; strategyName: (id: string) => string }) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const label = (id: string) =>
    id === "manual" ? "手动" : id === "mixed" ? "混合" : id === "custom" ? "自定义策略" : strategyName(id);

  useEffect(() => {
    let alive = true;
    fetch("/api/leaderboard", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as LeaderboardData & { error?: string };
        if (!alive) return;
        if (!response.ok) throw new Error(body.error ?? "排行榜暂时打不开");
        setData(body);
        setError(null);
      })
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : "排行榜暂时打不开"));
    return () => {
      alive = false;
    };
  }, [sync.version]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const problem = await sync.saveNickname(draft);
    setSaving(false);
    setFormError(problem);
    if (!problem) setEditing(false);
  };

  const showForm = !sync.nickname || editing;
  const t = data?.totals;

  return (
    <section className="pe-board" aria-label="全站排行榜">
      <div className="pe-card-panel">
        <div className="pe-card-panel__head">
          <span className="pe-label">全站排行榜</span>
          <small className="pe-cap">所有来过这里的人，每走一趟记一笔（只记“你”座位，不记常客）。地区按网络大致定位到城市。</small>
        </div>

        {showForm ? (
          <form className="pe-board__nick" onSubmit={submit}>
            <label>
              <span>{sync.nickname ? "改昵称" : "起个昵称就能上榜"}</span>
              <input
                value={draft}
                maxLength={NICKNAME_MAX}
                placeholder="1–16 个字"
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            <button type="submit" disabled={saving || !draft.trim()}>
              {saving ? "保存中" : "保存"}
            </button>
            {sync.nickname && (
              <button type="button" className="is-ghost" onClick={() => setEditing(false)}>
                取消
              </button>
            )}
            {sync.unsent > 0 && <small>这次已经走了 {sync.unsent} 趟，存好昵称后会补上。</small>}
            {formError && <small className="is-loss">{formError}</small>}
          </form>
        ) : (
          <p className="pe-board__me">
            你在榜上叫 <b>{sync.nickname}</b>，每走一趟自动记上。
            <button
              type="button"
              className="is-ghost"
              onClick={() => {
                setDraft(sync.nickname ?? "");
                setEditing(true);
              }}
            >
              改昵称
            </button>
          </p>
        )}

        {error && <p className="pe-cap is-loss">{error}</p>}
        {!data && !error && <p className="pe-cap">读取中…</p>}

        {t && (
          <>
            <div className="pe-ledger-summary pe-board__totals">
              <span>
                来过的人<b>{t.players.toLocaleString()}</b>
              </span>
              <span>
                走了几趟<b>{t.runs.toLocaleString()}</b>
              </span>
              <span>
                赢着走<b>{pct(t.winningRuns, t.runs)}</b>
              </span>
              <span>
                所有人合计<b className={tone(t.totalNet)}>{formatSigned(t.totalNet)}</b>
              </span>
            </div>

            {data.byStrategy.length > 0 && (
              <div className="pe-board__block">
                <h3>按玩法</h3>
                <table className="pe-board__table">
                  <thead>
                    <tr>
                      <th>玩法</th>
                      <th>人</th>
                      <th>趟</th>
                      <th>赢着走</th>
                      <th>每趟平均</th>
                      <th>合计输赢</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byStrategy.map((row) => (
                      <tr key={row.strategy}>
                        <td>{label(row.strategy)}</td>
                        <td>{row.players}</td>
                        <td>{row.runs}</td>
                        <td>{pct(row.winningRuns, row.runs)}</td>
                        <td className={tone(row.totalNet)}>{formatSigned(Math.round(row.totalNet / row.runs))}</td>
                        <td className={tone(row.totalNet)}>{formatSigned(row.totalNet)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="pe-board__cols">
              <PlayerList title="赢得最多" rows={data.topPlayers} label={label} empty="还没有人生涯是赢的。" />
              <PlayerList title="输得最多" rows={data.bottomPlayers} label={label} empty="还没有人生涯是输的。" />
            </div>

            <div className="pe-board__block">
              <h3>最近走的</h3>
              {data.recent.length === 0 ? (
                <p className="pe-cap">还没有人走完一趟。</p>
              ) : (
                <ul className="pe-board__recent">
                  {data.recent.map((row, index) => (
                    <li key={index}>
                      <span>
                        {row.place ? `来自${row.place}的 ` : ""}
                        <b>{row.nickname}</b> 用{label(row.strategy)}玩了 {row.rounds} 局，{REASON_LABEL[row.reason] ?? row.reason}
                      </span>
                      <b className={tone(row.net)}>{formatSigned(row.net)}</b>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function PlayerList({
  title,
  rows,
  label,
  empty,
}: {
  title: string;
  rows: LeaderboardData["topPlayers"];
  label: (id: string) => string;
  empty: string;
}) {
  return (
    <div className="pe-board__block">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="pe-cap">{empty}</p>
      ) : (
        <ol className="pe-board__players">
          {rows.map((row, index) => (
            <li key={index}>
              <span>
                <b>{row.nickname}</b>
                <small>
                  {row.place ? `${row.place} · ` : ""}
                  常用{label(row.strategy)} · {row.runs} 趟，赢着走 {row.winningRuns}
                </small>
              </span>
              <b className={tone(row.totalNet)}>{formatSigned(row.totalNet)}</b>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
