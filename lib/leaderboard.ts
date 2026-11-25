/**
 * 全站排行榜：页面、接口、Worker 共用的常量、类型与校验（纯函数，不依赖 React 或 D1）。
 * 不防作弊（2026-11-25 负责人决定），这里只挡格式错误和明显离谱的数。
 */

/** worker/index.ts 把 Cloudflare 的 IP 定位写进这些请求头；客户端发来的同名头会被删掉。 */
export const GEO_HEADERS = { country: "x-pe-geo-country", region: "x-pe-geo-region", city: "x-pe-geo-city" } as const;

export const NICKNAME_MAX = 16;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const STRATEGY_RE = /^[a-z0-9_-]{1,32}$/;
const REASONS = ["bankrupt", "insufficient_funds", "left", "stop_win", "stop_loss", "time_up"] as const;
/** 单趟数额的上限：带入最多初始本金 × 补仓 10 倍很多次，给足余量。 */
const MAX_POINTS = 100_000_000;
const MAX_ROUNDS = 1_000_000;

export interface RunUpload {
  deviceId: string;
  clientKey: string;
  strategy: string;
  buyIn: number;
  cashOut: number;
  rounds: number;
  buyIns: number;
  reason: (typeof REASONS)[number];
}

export interface StrategyRow {
  strategy: string;
  runs: number;
  players: number;
  winningRuns: number;
  totalBuyIn: number;
  totalNet: number;
  totalRounds: number;
}

export interface RecentRow {
  nickname: string;
  place: string | null;
  strategy: string;
  net: number;
  rounds: number;
  reason: string;
  createdAt: string;
}

export interface PlayerRow {
  nickname: string;
  place: string | null;
  runs: number;
  winningRuns: number;
  totalNet: number;
  /** 这个人用得最多的玩法。 */
  strategy: string;
}

export interface LeaderboardData {
  totals: { players: number; runs: number; winningRuns: number; totalNet: number; totalBuyIn: number };
  byStrategy: StrategyRow[];
  recent: RecentRow[];
  topPlayers: PlayerRow[];
  bottomPlayers: PlayerRow[];
}

export function cleanNickname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // 去掉控制字符和首尾空白，连续空白压成一个。
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (!name || [...name].length > NICKNAME_MAX) return null;
  return name;
}

export function isId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

function isCount(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

/** 返回校验后的上传内容，或一句中文错误。 */
export function parseRunUpload(body: unknown): RunUpload | string {
  if (!body || typeof body !== "object") return "格式不对";
  const b = body as Record<string, unknown>;
  if (!isId(b.deviceId)) return "deviceId 不对";
  if (typeof b.clientKey !== "string" || !/^[A-Za-z0-9_#:-]{8,128}$/.test(b.clientKey)) return "clientKey 不对";
  if (typeof b.strategy !== "string" || !STRATEGY_RE.test(b.strategy)) return "strategy 不对";
  if (!isCount(b.buyIn, MAX_POINTS) || b.buyIn <= 0) return "buyIn 不对";
  if (!isCount(b.cashOut, MAX_POINTS)) return "cashOut 不对";
  if (!isCount(b.rounds, MAX_ROUNDS)) return "rounds 不对";
  if (!isCount(b.buyIns, 10_000) || b.buyIns < 1) return "buyIns 不对";
  if (!REASONS.includes(b.reason as RunUpload["reason"])) return "reason 不对";
  return {
    deviceId: b.deviceId,
    clientKey: b.clientKey,
    strategy: b.strategy,
    buyIn: b.buyIn,
    cashOut: b.cashOut,
    rounds: b.rounds,
    buyIns: b.buyIns,
    reason: b.reason as RunUpload["reason"],
  };
}

function decodeGeo(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value).slice(0, 64) || null;
  } catch {
    return null;
  }
}

export function geoFromHeaders(headers: Headers) {
  return {
    country: decodeGeo(headers.get(GEO_HEADERS.country)),
    region: decodeGeo(headers.get(GEO_HEADERS.region)),
    city: decodeGeo(headers.get(GEO_HEADERS.city)),
  };
}

function countryName(code: string): string {
  if (code === "TW") return "中国台湾";
  if (code === "HK") return "中国香港";
  if (code === "MO") return "中国澳门";
  try {
    return new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** “来自 xx”：城市优先；城市和地区同名时只写一个；没有定位就是 null。 */
export function placeLabel(country: string | null, region: string | null, city: string | null): string | null {
  const parts: string[] = [];
  const name = country ? countryName(country) : null;
  if (name && name !== "中国") parts.push(name);
  if (region && region !== city) parts.push(region);
  if (city) parts.push(city);
  if (!parts.length && name) parts.push(name);
  return parts.length ? parts.join(" ") : null;
}
