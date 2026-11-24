import type { VisitPlan } from "../../core/types.ts";

/**
 * Regulars at the table. Each comes with the amount they usually bring and their own habit of
 * when to go home (all optional; several have none and only leave when broke or out of funds).
 * `id` is the person: the lifetime ledger follows it across visits.
 */
export const PLAYER_PROFILES: readonly {
  id: string;
  name: string;
  strategyId: string;
  bankroll: number;
  plan: VisitPlan;
}[] = [
  { id: "profile-heng", name: "阿衡", strategyId: "flat", bankroll: 800, plan: { stopWin: 200, maxRounds: 150 } },
  { id: "profile-man", name: "小满", strategyId: "martingale", bankroll: 1200, plan: { stopWin: 300 } },
  { id: "profile-chen", name: "老陈", strategyId: "dalembert", bankroll: 1000, plan: { stopLoss: 500, maxRounds: 200 } },
  { id: "profile-lin", name: "Lin", strategyId: "kelly", bankroll: 1600, plan: { maxRounds: 120 } },
  { id: "profile-anhe", name: "安禾", strategyId: "conservative", bankroll: 600, plan: { stopWin: 100, stopLoss: 300 } },
  { id: "profile-gao", name: "高峰", strategyId: "aggressive", bankroll: 1800, plan: {} },
  { id: "profile-wei", name: "魏叔", strategyId: "highroller", bankroll: 3000, plan: { stopWin: 1000 } },
  { id: "profile-ruo", name: "若水", strategyId: "front", bankroll: 1400, plan: { stopWin: 400, stopLoss: 700 } },
  { id: "profile-ke", name: "可可", strategyId: "back", bankroll: 1100, plan: { maxRounds: 100 } },
  { id: "profile-jia", name: "嘉树", strategyId: "adaptive", bankroll: 900, plan: { stopWin: 200, stopLoss: 450, maxRounds: 150 } },
  { id: "profile-jie", name: "阿杰", strategyId: "martingale", bankroll: 700, plan: { stopWin: 150 } },
  { id: "profile-wen", name: "晓雯", strategyId: "flat", bankroll: 500, plan: { maxRounds: 80 } },
  { id: "profile-zhong", name: "老钟", strategyId: "conservative", bankroll: 2000, plan: { stopLoss: 400 } },
  { id: "profile-qi", name: "美琪", strategyId: "front", bankroll: 1000, plan: { stopWin: 300, maxRounds: 100 } },
  { id: "profile-peng", name: "大鹏", strategyId: "highroller", bankroll: 2500, plan: {} },
  { id: "profile-xiaolin", name: "小林", strategyId: "kelly", bankroll: 1200, plan: { stopWin: 200, stopLoss: 600 } },
  { id: "profile-zhen", name: "阿珍", strategyId: "dalembert", bankroll: 800, plan: { maxRounds: 60 } },
  { id: "profile-bin", name: "文斌", strategyId: "aggressive", bankroll: 1500, plan: { stopWin: 500, stopLoss: 1000 } },
  { id: "profile-yue", name: "秋月", strategyId: "back", bankroll: 900, plan: { stopWin: 150, maxRounds: 120 } },
  { id: "profile-de", name: "德叔", strategyId: "adaptive", bankroll: 1300, plan: {} },
];
