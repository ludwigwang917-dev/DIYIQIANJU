/**
 * 新 UI 组件的独立预览（不进入正式页面路由）。
 * 构建：sh design/preview/build.sh（生成单文件 design/preview/preview.html）
 * index.html 是模板，preview.html 是可直接打开的结果。
 */
import { createRoot } from "react-dom/client";
import "../../app/components/ui/table.css";
import { CardFace } from "../../app/components/ui/card-face";
import { ChipButton, ChipStack } from "../../app/components/ui/chips";
import { FeltTable, SeatAnchor, STAGE_W } from "../../app/components/ui/felt-table";
import { Hand, handFormula, type HandCard } from "../../app/components/ui/hand";

const c = (rank: string, suit: string, dimmed: boolean): HandCard => ({ rank, suit, faceUp: true, dimmed });

// 示例数据：dimmed = 不在凑牛三张里（与游戏层 viewOf 的约定相同），故意打乱顺序以检验分组
const dealer = { label: "牛七", multiplier: 2, cards: [c("2", "diamond", true), c("K", "spade", false), c("7", "heart", false), c("5", "heart", true), c("3", "club", false)] };
const seats: ({ cards: HandCard[]; label: string; lost: boolean; bet: [number, number] } | null)[] = [
  { cards: [c("2", "spade", false), c("8", "heart", false), c("K", "club", false), c("5", "spade", true), c("Q", "diamond", true)], label: "牛五", lost: true, bet: [20, 10] },
  { cards: [c("A", "heart", false), c("9", "spade", false), c("J", "club", false), c("4", "diamond", true), c("4", "spade", true)], label: "牛八", lost: false, bet: [150, 100] },
  null,
  { cards: [c("3", "club", false), c("7", "spade", false), c("SJ", "joker", false), c("10", "club", true), c("2", "diamond", true)], label: "牛二", lost: true, bet: [10, 10] },
  { cards: [c("5", "diamond", true), c("BJ", "joker", true), c("6", "spade", true), c("9", "heart", true), c("4", "club", true)], label: "无牛", lost: true, bet: [10, 50] },
];

const SPEC: [string, string][] = [
  ["A", "spade"], ["2", "heart"], ["3", "club"], ["4", "diamond"], ["5", "spade"], ["6", "heart"], ["7", "club"],
  ["8", "diamond"], ["9", "spade"], ["10", "heart"], ["J", "club"], ["Q", "diamond"], ["K", "spade"], ["SJ", "joker"], ["BJ", "joker"],
];

function Preview() {
  return (
    <div style={{ maxWidth: STAGE_W, margin: "0 auto", padding: 20 }}>
      <h2 className="ph">牌面（含大小王、牌背）</h2>
      <div className="row felt-bg">
        {SPEC.map(([rank, suit]) => (
          <CardFace key={rank + suit} rank={rank} suit={suit} width={66} />
        ))}
        <CardFace rank="" suit="" faceUp={false} width={66} />
      </div>

      <h2 className="ph">筹码</h2>
      <div className="row felt-bg" style={{ alignItems: "flex-end", gap: 28, paddingTop: 40 }}>
        {[1, 5, 13, 50, 85, 100, 240, 500].map((amount) => (
          <span key={amount} style={{ textAlign: "center", color: "#cfc4a8", fontSize: 12 }}>
            <ChipStack amount={amount} />
            <div style={{ marginTop: 10 }}>{amount}</div>
          </span>
        ))}
        {([10, 50, 100, 500] as const).map((value) => (
          <ChipButton key={value} value={value} disabled={value === 500} />
        ))}
      </div>

      <h2 className="ph">牌桌（铭牌在第 2 步做）</h2>
      <FeltTable oddsText="牛牛 ×5 · 牛九 ×4 · 牛八 ×3 · 牛七 ×2 · 同牌型庄家胜" boxLabels={["前注", "后注"]}>
        <div className="pe-anchor" style={{ left: 560, top: 168, transform: "translate(-50%, -50%)" }}>
          <Hand cards={dealer.cards} label={dealer.label} width={58} spacing={8} gap={14} />
        </div>
        <div className="pe-anchor demo-result" style={{ left: 560, top: 236, transform: "translate(-50%, -50%)" }}>
          <em>{handFormula(dealer.cards, dealer.label)}</em>
          <b>庄 · {dealer.label} ×{dealer.multiplier}</b>
        </div>
        {seats.map((seat, index) =>
          seat ? (
            <div key={index}>
              <SeatAnchor seatIndex={index} ring="hand" rotate>
                <Hand cards={seat.cards} label={seat.label} lost={seat.lost} width={46} spacing={-28} gap={6} fan={4} />
              </SeatAnchor>
              <SeatAnchor seatIndex={index} ring="box" rotate>
                <span style={{ display: "flex", gap: 16 }}>
                  <ChipStack amount={seat.bet[0]} />
                  <ChipStack amount={seat.bet[1]} />
                </span>
              </SeatAnchor>
            </div>
          ) : null,
        )}
      </FeltTable>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
