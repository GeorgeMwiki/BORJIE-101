/**
 * Injected ports for the FX-treasury advisor.
 */

import type {
  TreasuryAnalysis,
  TreasuryInput,
  FxRate,
} from './types.js';

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface LmbmTreasuryPort {
  fetchTreasuryInput(args: { readonly mineId: string }): Promise<TreasuryInput>;
  saveAnalysis(args: {
    readonly mineId: string;
    readonly analysis: TreasuryAnalysis;
  }): Promise<{ readonly factId: string }>;
}

export interface FxRateFeedPort {
  getRates(pairs: ReadonlyArray<string>): Promise<ReadonlyArray<FxRate>>;
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
