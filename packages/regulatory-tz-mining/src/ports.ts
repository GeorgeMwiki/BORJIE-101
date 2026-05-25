/**
 * Injected ports for the TZ mining regulatory adapter.
 */

import type { RegulatoryAnalysis, RegulatoryFacts } from './types.js';

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface LmbmRegulatoryPort {
  fetchFacts(args: { readonly mineId: string }): Promise<RegulatoryFacts>;
  saveAnalysis(args: {
    readonly mineId: string;
    readonly analysis: RegulatoryAnalysis;
  }): Promise<{ readonly factId: string }>;
}

export const NOOP_LOGGER: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
