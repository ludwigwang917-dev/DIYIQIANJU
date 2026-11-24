/**
 * 斗牛理论期望值（EV）的精确计算与模拟复核。
 *
 * 用法（Node 22.13+ 可直接运行 .ts）：
 *   node scripts/niuniu-ev.ts              # 精确枚举，约几十秒
 *   node scripts/niuniu-ev.ts --simulate   # 另外用游戏模块的 settle 跑随机模拟复核
 *
 * 推导见 docs/niuniu-ev-derivation.md。核心结论：一名闲家与庄家的两手牌
 * 在洗匀的牌里是“可交换”的，所以胜负两边的赔付互相抵消，闲家的期望亏损
 * 只来自“完全相同归庄”的平局：
 *   前注 EV / 每 1 点前注 = −E[倍率 × 1{平局}]
 *   后注 EV / 每 1 点后注 = −P(平局)
 * 本脚本直接调用 lib/games/niuniu/kernel.ts 的评牌与比牌函数，不另写规则，
 * 所以 kernel 的规则一改（例如 2026-11-24 起“三张和为 30 也算牛”），重跑即得新结果。
 */
import { cardPoint, compareHands, createDeck, evaluateHand, handMultiplier, shuffle, type Card } from "../lib/games/niuniu/kernel.ts";
import { niuniuModule } from "../lib/games/niuniu/module.ts";
import { mulberry32 } from "../lib/core/rng.ts";

const deck = createDeck();
const N = deck.length; // 54

// ---------- 组合数与子集编号（colex 排名） ----------
const binom: number[][] = Array.from({ length: N + 1 }, () => Array(6).fill(0));
for (let n = 0; n <= N; n += 1) {
  binom[n][0] = 1;
  for (let k = 1; k <= 5; k += 1) binom[n][k] = n === 0 ? 0 : binom[n - 1][k - 1] + binom[n - 1][k];
}
const rankOf = (sorted: number[]) => sorted.reduce((sum, c, i) => sum + binom[c][i + 1], 0);

/** 比牌时“完全相同”的分组键：牛值 + 最大单张的点数 + 花色强度（与 kernel 的 compareSingleCards 一致）。 */
function suitKey(card: Card): string {
  return card.suit === "joker" ? card.rank : card.suit;
}
function tieKey(cattle: number, maxCard: Card): string {
  return `${cattle}|${cardPoint(maxCard)}|${suitKey(maxCard)}`;
}

// ---------- 1. 枚举全部 C(54,5) 手牌 ----------
const totalHands = binom[N][5];
const handCards = new Uint8Array(totalHands * 5);
const handCattle = new Uint8Array(totalHands);
const groups = new Map<string, number[]>();
const cattleCount = new Array(11).fill(0);

let h = 0;
for (let a = 0; a < N; a += 1)
  for (let b = a + 1; b < N; b += 1)
    for (let c = b + 1; c < N; c += 1)
      for (let d = c + 1; d < N; d += 1)
        for (let e = d + 1; e < N; e += 1) {
          const hand = evaluateHand([deck[a], deck[b], deck[c], deck[d], deck[e]]);
          handCards.set([a, b, c, d, e], h * 5);
          handCattle[h] = hand.cattle;
          cattleCount[hand.cattle] += 1;
          const key = tieKey(hand.cattle, hand.maxCard);
          let list = groups.get(key);
          if (!list) groups.set(key, (list = []));
          list.push(h);
          h += 1;
        }

// ---------- 2. 每组内：数“互不重牌”的有序手牌对（容斥） ----------
const sizes = [1, N, binom[N][2], binom[N][3], binom[N][4]];
const counts = sizes.map((size) => new Int32Array(size));
const SUBSETS: number[][] = [];
for (let mask = 1; mask < 31; mask += 1) {
  // 1–4 张的真子集（5 张全集单独处理）
  const idx = [0, 1, 2, 3, 4].filter((i) => mask & (1 << i));
  if (idx.length <= 4) SUBSETS.push(idx);
}

const tiePairsByCattle = new Array(11).fill(0); // 有序对数量（BigInt 不必要：最大约 6e12 < 2^53）
for (const [key, members] of groups) {
  for (const arr of counts) arr.fill(0);
  const cards = [0, 0, 0, 0, 0];
  const load = (index: number) => {
    for (let i = 0; i < 5; i += 1) cards[i] = handCards[index * 5 + i];
  };
  for (const index of members) {
    load(index);
    for (const subset of SUBSETS) counts[subset.length][rankOf(subset.map((i) => cards[i]))] += 1;
  }
  let pairs = 0;
  for (const index of members) {
    load(index);
    let disjoint = members.length - 1; // 空集项 N，减去全集项（自己）1
    for (const subset of SUBSETS) {
      const n = counts[subset.length][rankOf(subset.map((i) => cards[i]))];
      disjoint += subset.length % 2 === 1 ? -n : n;
    }
    pairs += disjoint;
  }
  tiePairsByCattle[Number(key.split("|")[0])] += pairs;
}

// ---------- 3. 汇总 ----------
const totalPairs = binom[N][5] * binom[N - 5][5]; // 闲、庄两手互不重牌的有序对
const multiplier = handMultiplier; // 牛值对应的前注倍率，直接用 kernel 的赔率表

let pTie = 0;
let frontEdge = 0;
for (let cattle = 0; cattle <= 10; cattle += 1) {
  const p = tiePairsByCattle[cattle] / totalPairs;
  pTie += p;
  frontEdge += p * multiplier(cattle);
}

const pct = (x: number, digits = 4) => `${(x * 100).toFixed(digits)}%`;
console.log(`全部手牌 C(54,5) = ${totalHands.toLocaleString()}`);
console.log("单手牛值分布：");
for (let cattle = 0; cattle <= 10; cattle += 1) {
  const label = cattle === 0 ? "无牛" : cattle === 10 ? "牛牛" : `牛${cattle}`;
  console.log(`  ${label.padEnd(4)} ×${multiplier(cattle)}  ${cattleCount[cattle].toLocaleString().padStart(9)}  ${pct(cattleCount[cattle] / totalHands, 3)}`);
}
console.log(`有序手牌对总数 = ${totalPairs.toLocaleString()}`);
console.log(`平局（归庄）概率 P(平局) = ${pct(pTie)}  （${tiePairsByCattle.reduce((s, x) => s + x, 0).toLocaleString()} 对）`);
console.log(`闲家胜率 = 庄家胜率（不含平局）= ${pct((1 - pTie) / 2)}`);
console.log(`前注 EV：每 1 点前注 ${(-frontEdge).toFixed(6)}（${pct(-frontEdge, 3)}）`);
console.log(`后注 EV：每 1 点后注 ${(-pTie).toFixed(6)}（${pct(-pTie, 3)}）`);
console.log("各牛值的平局概率：");
for (let cattle = 0; cattle <= 10; cattle += 1) {
  if (tiePairsByCattle[cattle]) console.log(`  牛值 ${cattle}: ${pct(tiePairsByCattle[cattle] / totalPairs, 5)}`);
}

// ---------- 4. 自检：分组键与 compareHands 的“完全相同”一致 ----------
let seed = 20261124;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
for (let trial = 0; trial < 200_000; trial += 1) {
  const shuffled = shuffle(deck, rand).slice(0, 10);
  const a = evaluateHand(shuffled.slice(0, 5));
  const b = evaluateHand(shuffled.slice(5));
  const sameKey = tieKey(a.cattle, a.maxCard) === tieKey(b.cattle, b.maxCard);
  if (sameKey !== (compareHands(a, b) === 0)) throw new Error("tieKey 与 compareHands 不一致");
}
console.log("自检：tieKey 与 compareHands 在 20 万对随机手牌上一致 ✓");

// ---------- 5. 可选：用游戏模块的 createRound + settle 随机模拟复核 ----------
if (process.argv.includes("--simulate")) {
  const rounds = 5_000_000;
  const seats = [0, 1, 2, 3, 4];
  const rng = mulberry32(20261124); // 与赌桌相同的随机数发生器
  // 同一局 5 席共用庄家牌，彼此相关，所以按“局”取样：每局取 5 席的平均值。
  let sumFront = 0, sumFrontSq = 0, sumBack = 0, sumBackSq = 0;
  for (let round = 0; round < rounds; round += 1) {
    const state = niuniuModule.createRound({ seatIndexes: seats, rng });
    const front = niuniuModule.settle(state, seats.map(() => ({ kind: "place_bet", front: 1, back: 0 })));
    const both = niuniuModule.settle(state, seats.map(() => ({ kind: "place_bet", front: 1, back: 1 })));
    let f = 0, b = 0;
    for (let i = 0; i < seats.length; i += 1) {
      f += front[i].delta / seats.length;
      b += (both[i].delta - front[i].delta) / seats.length; // 后注部分
    }
    sumFront += f; sumFrontSq += f * f; sumBack += b; sumBackSq += b * b;
  }
  const mean = (s: number) => s / rounds;
  const ci = (s: number, sq: number) => 1.96 * Math.sqrt((sq / rounds - mean(s) ** 2) / rounds);
  console.log(`模拟 ${rounds.toLocaleString()} 局 × 5 席（种子 20261124，按局计算 95% 置信区间）：`);
  console.log(`  前注 EV ≈ ${mean(sumFront).toFixed(5)} ± ${ci(sumFront, sumFrontSq).toFixed(5)}（理论 ${(-frontEdge).toFixed(5)}）`);
  console.log(`  后注 EV ≈ ${mean(sumBack).toFixed(5)} ± ${ci(sumBack, sumBackSq).toFixed(5)}（理论 ${(-pTie).toFixed(5)}）`);
}
