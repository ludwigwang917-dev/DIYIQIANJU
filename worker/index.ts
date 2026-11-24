/// <reference types="vite/client" />
/**
 * Cloudflare Worker entry point.
 *
 * Every page response gets the site's security headers. The Content-Security-Policy
 * carries a fresh nonce per request: vinext reads it from the request's
 * `content-security-policy` header and stamps it on the inline bootstrap scripts it
 * renders, so no other inline script can run.
 *
 * Static files under /assets and /public are served by Workers Static Assets before
 * this code runs; their headers come from `public/_headers`.
 *
 * The site has no database, no image optimisation and no third-party scripts, so the
 * template's D1 / IMAGES handling was removed (it pointed at bindings that do not exist).
 */
import handler from "vinext/server/app-router-entry";

type WorkerEnv = Parameters<typeof handler.fetch>[1];

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    // React sets inline style attributes for the felt table and charts.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    // The Monte Carlo Web Worker is a same-origin file under /assets.
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Only this site may frame itself. To let a partner embed the simulator,
    // add its origin here (and drop X-Frame-Options below).
    "frame-ancestors 'self'",
  ].join("; ");
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

const worker = {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    // The Vite dev server injects its own inline scripts; only lock down real builds.
    if (import.meta.env.DEV) return handler.fetch(request, env, ctx);

    const csp = contentSecurityPolicy(createNonce());
    const forwarded = new Headers(request.headers);
    forwarded.set("content-security-policy", csp);

    const response = await handler.fetch(new Request(request, { headers: forwarded }), env, ctx);

    const secured = new Response(response.body, response);
    secured.headers.set("Content-Security-Policy", csp);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);
    return secured;
  },
};

export default worker;
