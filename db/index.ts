import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type D1 = {
  exec(query: string): Promise<unknown>;
};

// 动态导入：Node 里的测试会加载整个 Worker 包，静态导入 cloudflare:workers 会让它直接报错。
async function binding(): Promise<D1 & Parameters<typeof drizzle>[0]> {
  const { env } = await import("cloudflare:workers");
  const db = (env as { DB?: D1 & Parameters<typeof drizzle>[0] }).DB;
  if (!db) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the real database id in vite.config.ts (or the D1_DATABASE_ID env var).",
    );
  }
  return db;
}

/**
 * 表结构与 db/schema.ts 一致。第一次请求时用 IF NOT EXISTS 建表，
 * 这样本地开发和第一次部署都不用另外跑迁移命令。改表结构时两边一起改。
 */
const DDL = [
  `CREATE TABLE IF NOT EXISTS players (
    device_id TEXT PRIMARY KEY NOT NULL,
    nickname TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    client_key TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    strategy TEXT NOT NULL,
    buy_in INTEGER NOT NULL,
    cash_out INTEGER NOT NULL,
    net INTEGER NOT NULL,
    rounds INTEGER NOT NULL,
    buy_ins INTEGER NOT NULL,
    reason TEXT NOT NULL,
    country TEXT,
    region TEXT,
    city TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS runs_device_idx ON runs (device_id)`,
  `CREATE INDEX IF NOT EXISTS runs_strategy_idx ON runs (strategy)`,
];

let schemaReady: Promise<void> | null = null;

export async function getDb() {
  const raw = await binding();
  schemaReady ??= (async () => {
    // D1 的 exec 一次只认单行语句，所以逐条执行并把换行压掉。
    for (const statement of DDL) await raw.exec(statement.replace(/\s+/g, " "));
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  await schemaReady;
  return drizzle(raw, { schema });
}
