/**
 * Injected ports — caller wires concrete LMBM / brain / observability
 * implementations. Defined structurally so this package compiles
 * standalone with no workspace dependency resolution required.
 */

import type { CostAnalyzeInput, CostAnalysis } from './types.js';

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface LmbmReadPort {
  /** Fetch the latest cost-engineer input snapshot for a mine + period. */
  fetchCostInput(args: {
    readonly mineId: string;
    readonly periodLabel: string;
  }): Promise<CostAnalyzeInput>;
}

export interface LmbmWritePort {
  /** Persist a completed analysis back to the LMBM as a derived fact. */
  saveAnalysis(args: {
    readonly mineId: string;
    readonly analysis: CostAnalysis;
  }): Promise<{ readonly factId: string }>;
}

export interface BrainPort {
  rationalise(req: {
    readonly systemPrompt: string;
    readonly snippets: ReadonlyArray<{ id: string; summary: string }>;
  }): Promise<{ text: string }>;
}

export const NOOP_LOGGER: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
