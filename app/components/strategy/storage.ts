import { CUSTOM_STRATEGY_PREFIX } from "@/lib/core/registry";
import { registerRuleStrategy } from "@/lib/core/rules/compile";
import type { RuleStrategy } from "@/lib/core/rules/types";
import { validateRuleStrategy } from "@/lib/core/rules/validate";

/** One strategy saved in this browser. */
export interface SavedStrategy {
  id: string;
  strategy: RuleStrategy;
  updatedAt: number;
}

const STORAGE_KEY = "diyiqianju.strategies.v1";

/**
 * Read saved strategies from this browser and register each so seats and experiments can use
 * it. Stored data is not trusted: anything that fails validation is skipped.
 */
export function loadSavedStrategies(gameId: string): SavedStrategy[] {
  if (typeof window === "undefined") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const saved: SavedStrategy[] = [];
  for (const item of parsed) {
    const entry = item as Partial<SavedStrategy>;
    if (typeof entry?.id !== "string" || !entry.id.startsWith(CUSTOM_STRATEGY_PREFIX)) continue;
    if (validateRuleStrategy(entry.strategy, gameId).length) continue;
    registerRuleStrategy(entry.strategy, entry.id);
    saved.push({ id: entry.id, strategy: entry.strategy as RuleStrategy, updatedAt: Number(entry.updatedAt) || 0 });
  }
  return saved;
}

function persist(list: SavedStrategy[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Save (add or replace) and register. Returns the new list and whether the browser kept it. */
export function saveStrategy(list: SavedStrategy[], id: string | null, strategy: RuleStrategy) {
  const finalId = id ?? `${CUSTOM_STRATEGY_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  registerRuleStrategy(strategy, finalId);
  const entry: SavedStrategy = { id: finalId, strategy, updatedAt: Date.now() };
  const next = list.some((item) => item.id === finalId)
    ? list.map((item) => (item.id === finalId ? entry : item))
    : [...list, entry];
  return { list: next, id: finalId, stored: persist(next) };
}

/** Remove from this browser. A seat already using it keeps playing it until the table resets. */
export function deleteStrategy(list: SavedStrategy[], id: string) {
  const next = list.filter((item) => item.id !== id);
  persist(next);
  return next;
}
