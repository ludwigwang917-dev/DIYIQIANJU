/// <reference lib="webworker" />

import { runMonteCarlo, type MonteCarloRequest } from "../lib/core/monte-carlo.ts";
import "../lib/games/niuniu/index.ts";

self.onmessage = (event: MessageEvent<Omit<MonteCarloRequest, "gameId">>) => {
  try {
    const result = runMonteCarlo({ gameId: "niuniu", ...event.data }, (progress) =>
      self.postMessage({ type: "progress", progress }),
    );
    self.postMessage({ type: "complete", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
