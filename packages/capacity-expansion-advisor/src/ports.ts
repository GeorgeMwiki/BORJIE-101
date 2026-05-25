/**
 * Injected ports for the capacity-expansion advisor.
 */

import type {
  ExpansionAnalysis,
  ExpansionAnalyzeInput,
} from './types.js';

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface LmbmExpansionPort {
  fetchExpansionInput(args: {
    readonly mineId: string;
  }): Promise<ExpansionAnalyzeInput>;
  saveAnalysis(args: {
    readonly mineId: string;
    readonly analysis: ExpansionAnalysis;
  }): Promise<{ readonly factId: string }>;
}

export const NOOP_LOGGER: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
