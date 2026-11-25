import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * 全站排行榜（2026-11-25）：只记真人“你”座位的每一趟，常客（AI）不上传。
 * 没有账号：一台浏览器一个随机 deviceId + 自己起的昵称；不防作弊（负责人决定）。
 * 地区来自 Cloudflare 的 IP 定位，只存到城市。
 */
export const players = sqliteTable("players", {
  deviceId: text("device_id").primaryKey(),
  nickname: text("nickname").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const runs = sqliteTable(
  "runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 客户端生成的去重键：同一趟重复上传只记一次。 */
    clientKey: text("client_key").notNull().unique(),
    deviceId: text("device_id").notNull(),
    /** "manual"、预设策略 id，或 "mixed"（这趟中途换过玩法）。 */
    strategy: text("strategy").notNull(),
    buyIn: integer("buy_in").notNull(),
    cashOut: integer("cash_out").notNull(),
    net: integer("net").notNull(),
    rounds: integer("rounds").notNull(),
    buyIns: integer("buy_ins").notNull(),
    reason: text("reason").notNull(),
    country: text("country"),
    region: text("region"),
    city: text("city"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("runs_device_idx").on(table.deviceId), index("runs_strategy_idx").on(table.strategy)],
);
