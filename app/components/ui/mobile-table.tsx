import { Hand, type HandCard } from "./hand";
import { Avatar, EmptySeat, Plaque, type PlaqueData } from "./plaque";

/**
 * 手机竖屏用的竖向牌桌（设计定稿 design/mobile-v1.html）：
 * 庄家在上，01–04 两两一排，05 单独占最下一整行。材质与桌面版相同。
 */

export interface SeatModel {
  index: number;
  plaque: PlaqueData | null;
  cards: HandCard[] | null;
  label: string | null;
  lost: boolean;
}

export function MobileTable({
  dealerName,
  dealerNote,
  dealerCards,
  dealerResult,
  formula,
  seats,
  onDealerClick,
  onSeatClick,
  waitingText = "本局还没发牌",
}: {
  dealerName: string;
  dealerNote?: string;
  dealerCards: HandCard[] | null;
  dealerResult: string | null;
  /** 庄家还没亮牌时显示的文字。 */
  waitingText?: string;
  formula: string | null;
  seats: SeatModel[];
  onDealerClick: () => void;
  onSeatClick: (index: number) => void;
}) {
  const cell = (seat: SeatModel, wide: boolean) => (
    <div key={seat.index} className={`pe-mseat ${wide ? "pe-mseat--wide" : ""} ${seat.plaque ? "" : "pe-mseat--empty"}`} data-n={`0${seat.index + 1}`}>
      {seat.plaque ? (
        <>
          <Hand
            cards={seat.cards}
            label={seat.label}
            lost={seat.lost}
            width={wide ? 50 : 32}
            spacing={wide ? 6 : -12}
            gap={wide ? 6 : 17}
            className="pe-mseat__hand"
          />
          <Plaque data={seat.plaque} seatNumber={seat.index + 1} onClick={() => onSeatClick(seat.index)} compact />
        </>
      ) : (
        <>
          <span className="pe-mseat__ash" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((ember) => (
              <i key={ember} style={{ left: `${22 + ember * 13}%`, top: `${30 + (ember % 2) * 22}%` }} />
            ))}
          </span>
          <EmptySeat seatNumber={seat.index + 1} onClick={() => onSeatClick(seat.index)} compact />
        </>
      )}
    </div>
  );

  return (
    <div className="pe-mtable">
      <div className="pe-mtable__trim">
        <div className="pe-mtable__felt">
          <div className="pe-felt__mottle" />
          <div className="pe-felt__fiber" />
          <div className="pe-felt__fluff" />
          <div className="pe-mtable__light" />
          <div className="pe-mtable__content">
            <button type="button" className="pe-dealer pe-dealer--m" onClick={onDealerClick} aria-label="更换荷官">
              <Avatar name={dealerName} size={24} ring="#c9a35c" />
              <b>荷官 · {dealerName}</b>
              {dealerNote && <small>{dealerNote}</small>}
            </button>
            <Hand cards={dealerCards} label={dealerResult} width={50} spacing={6} gap={14} className="pe-mtable__dealer" />
            <div className="pe-result">
              {formula && <em>{formula}</em>}
              <b>{dealerResult ? `庄 · ${dealerResult}` : waitingText}</b>
            </div>
            <div className="pe-mtable__print" aria-hidden="true">
              <div>牛牛 ×5 · 牛九 ×4 · 牛八 ×3 · 牛七 ×2</div>
              <div>同牌型 · 庄家胜</div>
              <strong>第一千局</strong>
            </div>
            <div className="pe-mtable__grid">{seats.slice(0, 4).map((seat) => cell(seat, false))}</div>
            {seats[4] && cell(seats[4], true)}
          </div>
        </div>
      </div>
    </div>
  );
}
