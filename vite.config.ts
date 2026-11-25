import vinext from "vinext";
import { defineConfig } from "vite";

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
  // No D1 or R2 bindings.
  d1_databases: [],
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
