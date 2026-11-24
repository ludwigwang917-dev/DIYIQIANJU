// Launch readiness: security headers, CSP nonces, share metadata, 404 page and
// static-asset config. Runs against the production build in dist/ (npm test builds first).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function fetchPage(path, host = "first-thousand.example") {
  const workerUrl = new URL("dist/server/index.js", root);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`https://${host}${path}`, { headers: { accept: "text/html", host } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

const readDist = (path) => readFile(new URL(path, root), "utf8");

test("pages carry the security headers and a per-request CSP nonce on every inline script", async () => {
  const first = await fetchPage("/");
  assert.equal(first.status, 200);
  const csp = first.headers.get("content-security-policy");
  assert.ok(csp, "Content-Security-Policy header is missing");
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  assert.ok(nonce, "CSP has no script nonce");
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /worker-src 'self'/);

  const html = await first.text();
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)].map((m) => m[0]);
  assert.ok(inline.length > 0, "expected vinext bootstrap scripts");
  for (const tag of inline) assert.ok(tag.includes(`nonce="${nonce}"`), `inline script without the nonce: ${tag}`);

  for (const [name, value] of [
    ["x-content-type-options", "nosniff"],
    ["x-frame-options", "SAMEORIGIN"],
    ["referrer-policy", "strict-origin-when-cross-origin"],
    ["cross-origin-opener-policy", "same-origin"],
    ["strict-transport-security", "max-age=31536000"],
  ]) {
    assert.equal(first.headers.get(name), value, name);
  }
  assert.match(first.headers.get("permissions-policy") ?? "", /camera=\(\)/);

  const second = await fetchPage("/");
  const secondNonce = /'nonce-([^']+)'/.exec(second.headers.get("content-security-policy"))?.[1];
  assert.notEqual(secondNonce, nonce, "nonce must change per request");
});

test("share metadata, icons and theme use the request's own origin", async () => {
  const html = await (await fetchPage("/")).text();
  assert.match(html, /<meta property="og:title" content="第一千局｜斗牛长期性模拟实验室"\/>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/first-thousand\.example\/opengraph-image\.png\?[^"]+"\/>/);
  assert.match(html, /<meta property="og:image:alt" content="[^"]*谁还在桌上[^"]*"\/>/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"\/>/);
  assert.match(html, /<link rel="icon" href="https:\/\/first-thousand\.example\/icon\.svg\?[^"]+"/);
  assert.match(html, /<link rel="apple-touch-icon" href="[^"]+apple-icon\.png\?[^"]+" sizes="180x180"/);
  assert.match(html, /<meta name="theme-color" content="#0b0b0a"\/>/);

  for (const [path, type] of [
    ["/icon.svg", "image/svg+xml"],
    ["/apple-icon.png", "image/png"],
    ["/opengraph-image.png", "image/png"],
  ]) {
    const response = await fetchPage(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("content-type"), type, path);
  }
});

test("unknown paths get a Chinese 404 page that keeps the notice and help links", async () => {
  const response = await fetchPage("/no-such-table");
  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.ok(response.headers.get("content-security-policy"));
  const html = await response.text();
  assert.match(html, /这张桌子不存在/);
  assert.match(html, /无真实货币 · 纯模拟 · 教育目的/);
  assert.match(html, /gamblersanonymous\.org/);
  assert.match(html, /who\.int/);
});

test("the template image endpoint no longer needs an IMAGES binding", async () => {
  const response = await fetchPage("/_vinext/image?url=%2Ficon.svg&w=64&q=75");
  assert.ok(response.status < 500, `got ${response.status}`);
});

test("static assets ship with cache and security headers, robots.txt, and a pinned worker config", async () => {
  const headers = await readDist("dist/client/_headers");
  assert.match(headers, /\/assets\/\*\s*\n\s*Cache-Control: public, max-age=31536000, immutable/);
  assert.match(headers, /\/\*\s*\n(\s+.+\n)*?\s+X-Content-Type-Options: nosniff/);
  assert.match(await readDist("dist/client/robots.txt"), /User-agent: \*/);
  const ico = await readFile(new URL("dist/client/favicon.ico", root));
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0], "favicon.ico should be an ICO file");

  const wrangler = JSON.parse(await readDist("dist/server/wrangler.json"));
  assert.equal(wrangler.name, "probability-ember-niuniu");
  assert.equal(wrangler.compatibility_date, "2026-05-15");
  assert.deepEqual(wrangler.d1_databases, []);
  assert.deepEqual(wrangler.r2_buckets, []);
  assert.equal(wrangler.observability?.enabled, true);
});
