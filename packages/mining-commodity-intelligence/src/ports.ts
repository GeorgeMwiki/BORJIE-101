/**
 * Ports for the commodity-intelligence advisor.
 */

import type { Commodity, IntelSnapshot, PriceTick } from './types.js';

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface PriceSourceAdapter {
  readonly name: string;
  fetchLatest(commodity: Commodity): Promise<PriceTick>;
  fetchHistory(
    commodity: Commodity,
    sinceISO: string,
  ): Promise<ReadonlyArray<PriceTick>>;
}

export interface LmbmIntelPort {
  saveSnapshot(args: {
    readonly snapshot: IntelSnapshot;
  }): Promise<{ readonly factId: string }>;
}

export const NOOP_LOGGER: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
