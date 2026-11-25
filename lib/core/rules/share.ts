import type { RuleStrategy } from "./types.ts";
import { validateRuleStrategy, type RuleIssue } from "./validate.ts";

/** Share links carry the strategy after `#strategy=` (never sent to the server). */
export const SHARE_KEY = "strategy";
const MAX_SHARE_LENGTH = 24_000;

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function encodeShare(strategy: RuleStrategy): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(strategy)));
}

/**
 * Read a shared strategy. What arrives in a link is untrusted data: it is decoded, size-checked
 * and validated, and only then handed back. Nothing in it is ever executed.
 */
export function decodeShare(
  text: string,
  gameId: string,
): { strategy: RuleStrategy; issues: [] } | { strategy: null; issues: RuleIssue[] } {
  if (text.length > MAX_SHARE_LENGTH) {
    return { strategy: null, issues: [{ where: "链接", message: "分享的策略太长了" }] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fromBase64Url(text)));
  } catch {
    return { strategy: null, issues: [{ where: "链接", message: "链接里的策略读不出来，可能复制不完整" }] };
  }
  const issues = validateRuleStrategy(parsed, gameId);
  return issues.length ? { strategy: null, issues } : { strategy: parsed as RuleStrategy, issues: [] };
}

/** The share payload in a location hash like "#strategy=…", or null. */
export function shareFromHash(hash: string): string | null {
  const match = new RegExp(`(?:^#|&)${SHARE_KEY}=([A-Za-z0-9_-]+)`).exec(hash);
  return match ? match[1] : null;
}
