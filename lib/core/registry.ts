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

export function getStrategies(gameId: string): StrategyModule[] {
  return strategiesByGame.get(gameId) ?? [];
}

export function listGames(): { id: string; name: string }[] {
  return [...games.values()].map((mod) => ({ id: mod.id, name: mod.meta.name }));
}
