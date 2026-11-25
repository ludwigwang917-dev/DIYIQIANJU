import vinext from "vinext";
import { defineConfig } from "vite";

// 全站排行榜的 D1（2026-11-25 用 `wrangler d1 create diyiqianju-leaderboard` 建，区域 WEUR）。
// 本地开发时 Miniflare 用同一个 id 在 .wrangler/ 下建本地库，不会碰线上数据。
const D1_DATABASE_ID = "0c98e530-941e-479e-95f3-b0004b4b95d3";

const localBindingConfig = {
  // Worker name = the workers.dev subdomain (https://<name>.<account>.workers.dev).
  // Still the pre-rename package name; whether to change it is the owner's call.
  name: "probability-ember-niuniu",
  main: "./worker/index.ts",
  // Pinned so a rebuild on a later day does not silently change runtime behaviour.
  compatibility_date: "2026-05-15",
  compatibility_flags: ["nodejs_compat"],
  // The site's own domain (bought on Cloudflare, zone in the same account).
  // `wrangler deploy` attaches these and Cloudflare issues the certificates.
  routes: [
    { pattern: "diyiqianju.com", custom_domain: true },
    { pattern: "www.diyiqianju.com", custom_domain: true },
  ],
  d1_databases: [
    {
      binding: "DB",
      database_name: "diyiqianju-leaderboard",
      database_id: D1_DATABASE_ID,
    },
  ],
  r2_buckets: [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
