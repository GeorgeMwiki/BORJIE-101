/**
 * Injected ports for the geology advisor.
 */

import type { GeologyAnalysis, GeologyInput } from './types.js';

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface LmbmGeologyPort {
  fetchGeologyInput(args: {
    readonly mineId: string;
  }): Promise<GeologyInput>;
  saveAnalysis(args: {
    readonly mineId: string;
    readonly analysis: GeologyAnalysis;
  }): Promise<{ readonly factId: string }>;
}

export const NOOP_LOGGER: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
