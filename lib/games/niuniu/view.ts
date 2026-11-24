export interface ViewCard {
  rank: string;
  suit: string;
  faceUp: boolean;
  dimmed: boolean;
}

export interface NiuniuSeatView {
  seatIndex: number;
  participating: boolean;
  cards: ViewCard[];
  label: string | null;
  multiplier: number | null;
}

export interface NiuniuView {
  dealer: {
    cards: ViewCard[];
    label: string | null;
    multiplier: number | null;
  };
  seats: NiuniuSeatView[];
}
