import type { GameModule, StrategyModule } from "./game-module.ts";

const games = new Map<string, GameModule>();
const strategiesByGame = new Map<string, StrategyModule[]>();

export function registerGame(mod: GameModule, strategies: StrategyModule[]): void {
  games.set(mod.id, mod);
  strategiesByGame.set(mod.id, strategies);
}

export function getGame(id: string): GameModule {
  const mod = games.get(id);
  if (!mod) throw new Error(`Unknown game: ${id}`);
  return mod;
}

/** Ids of strategies built in the strategy editor start with this (see lib/core/rules). */
export const CUSTOM_STRATEGY_PREFIX = "custom-";

export function isCustomStrategyId(id: string): boolean {
  return id.startsWith(CUSTOM_STRATEGY_PREFIX);
}

/**
 * Add a strategy at runtime (one built in the strategy editor), replacing any with the same id.
 * Seats and experiments refer to it by id like any preset.
 */
export function registerStrategy(gameId: string, strategy: StrategyModule): void {
  getGame(gameId);
  const list = (strategiesByGame.get(gameId) ?? []).filter((item) => item.id !== strategy.id);
  strategiesByGame.set(gameId, [...list, strategy]);
}

export function getStrategies(gameId: string): StrategyModule[] {
  return strategiesByGame.get(gameId) ?? [];
}

export function listGames(): { id: string; name: string }[] {
  return [...games.values()].map((mod) => ({ id: mod.id, name: mod.meta.name }));
}
