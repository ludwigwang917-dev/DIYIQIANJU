"use client";

import type { RoadMark } from "@/lib/core/casino";
import { formatSigned } from "./plaque";

/**
 * 大厅：每张桌一张卡片——游戏类型、荷官、空位、近期路单（庄/闲）、庄家累计。
 * 纯显示；路单只记过去的结果，下一局照样重新洗牌，卡片上要一直这么写。
 */

const fmt = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);

export type SeatDot = "you" | "taken" | "empty";

export interface LobbyTable {
  index: number;
  /** 例如“斗牛” */
  gameName: string;
  dealerName: string;
  /** 这位荷官还要发几局才换班 */
  shiftLeft: number;
  seats: SeatDot[];
  /** 旧 → 新 */
  road: RoadMark[];
  dealerProfit: number;
  rounds: number;
  viewing: boolean;
  youHere: boolean;
  /** 你在别的桌、这桌有空位、两桌都在两局之间 */
  canSwitch: boolean;
}

const MARK_LABEL: Record<RoadMark, string> = {
  dealer_sweep: "庄通杀",
  dealer: "庄赢",
  players: "闲赢",
  players_sweep: "庄通赔",
  even: "持平",
};

export function Lobby({
  tables,
  onView,
  onSwitch,
}: {
  tables: LobbyTable[];
  onView: (index: number) => void;
  onSwitch: (index: number) => void;
}) {
  return (
    <section className="pe-lobby" aria-label="大厅">
      <header className="pe-lobby__head">
        <h2>大厅</h2>
        <p>
          有空位才能坐。<b>路单只记过去：</b>每局都重新洗牌，前面开了多少把庄，和下一局没有关系。
        </p>
      </header>
      <div className="pe-lobby__grid">
        {tables.map((table) => {
          const empty = table.seats.filter((seat) => seat === "empty").length;
          const recent = table.road.slice(-24);
          const dealerWins = recent.filter((mark) => mark === "dealer" || mark === "dealer_sweep").length;
          const playerWins = recent.filter((mark) => mark === "players" || mark === "players_sweep").length;
          return (
            <article
              key={table.index}
              className={`pe-lobby__card ${table.viewing ? "is-viewing" : ""} ${table.youHere ? "is-yours" : ""}`}
            >
              <header>
                <b>{table.index + 1} 号桌</b>
                <span className="pe-lobby__game">{table.gameName}</span>
                {table.youHere && <span className="pe-lobby__tag">你在这桌</span>}
                {table.viewing && !table.youHere && <span className="pe-lobby__tag is-muted">正在看</span>}
              </header>
              <p className="pe-lobby__meta">
                荷官 {table.dealerName}（再 {table.shiftLeft} 局换班） · 已开 {fmt(table.rounds)} 局
              </p>
              <div className="pe-lobby__seats" aria-label={empty ? `空 ${empty} 位` : "满座"}>
                {table.seats.map((seat, seatIndex) => (
                  <i key={seatIndex} className={`is-${seat}`} />
                ))}
                <span>{empty ? `空 ${empty} 位` : "满座"}</span>
              </div>
              <div className="pe-lobby__road" aria-label={`近 ${recent.length} 局：庄赢 ${dealerWins}，闲赢 ${playerWins}`}>
                {recent.length === 0 ? (
                  <span className="pe-lobby__none">还没开局</span>
                ) : (
                  recent.map((mark, markIndex) => (
                    <i key={markIndex} className={`is-${mark}`} title={MARK_LABEL[mark]}>
                      {mark === "even" ? "" : mark.startsWith("dealer") ? "庄" : "闲"}
                    </i>
                  ))
                )}
              </div>
              <p className="pe-lobby__tally">
                近 {recent.length} 局 · 庄赢 <b>{dealerWins}</b> · 闲赢 <b>{playerWins}</b>
                <span>
                  庄家累计 <b className="pe-brass">{formatSigned(table.dealerProfit)}</b>
                </span>
              </p>
              <footer>
                {!table.viewing && (
                  <button type="button" className="pe-btn" onClick={() => onView(table.index)}>
                    去看看
                  </button>
                )}
                {table.canSwitch && (
                  <button type="button" className="pe-btn pe-btn--primary" onClick={() => onSwitch(table.index)}>
                    带筹码换到这桌
                  </button>
                )}
              </footer>
            </article>
          );
        })}
      </div>
      <p className="pe-lobby__legend">
        <i className="is-dealer">庄</i> 本局庄家赢得多 <i className="is-players">闲</i> 本局玩家赢得多　实心 = 通杀 / 通赔
      </p>
    </section>
  );
}
