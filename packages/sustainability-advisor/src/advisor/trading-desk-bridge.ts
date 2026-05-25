/**
 * Light-touch bridge from the sustainability advisor to the carbon-market
 * trading-desk layer.
 *
 * The advisor is the brain's entry-point for ESG work; some callers also
 * want to *act* on the recommendations (book forwards, run compliance
 * checks). This helper hands them a ready-to-use `TradingDesk` without
 * forcing them to know that `@borjie/carbon-market` exists.
 *
 * For tests / production they can still construct the desk directly via
 * the carbon-market package's own factories — this is purely convenience.
 */

import {
  createTradingDesk,
  createMockCixFeed,
  createInMemoryBookRepository,
  createVerraClient,
  createFetchTransport,
  type TradingDesk,
  type CreateTradingDeskOptions,
} from '@borjie/carbon-market';

export interface TradingDeskForOptions {
  /** Inject specific pieces; anything omitted falls back to defaults. */
  readonly overrides?: Partial<CreateTradingDeskOptions>;
}

/**
 * Build a `TradingDesk` for the given tenant with sensible defaults:
 *   - Verra registry client over global `fetch` (Node 22+)
 *   - Deterministic mock CIX feed (production wires a real feed)
 *   - In-memory book repository (production wires a persistent repo)
 */
export function tradingDeskFor(
  _tenantId: string,
  options: TradingDeskForOptions = {},
): TradingDesk {
  const overrides = options.overrides ?? {};
  return createTradingDesk({
    verra: overrides.verra ?? createVerraClient({ transport: createFetchTransport() }),
    cix: overrides.cix ?? createMockCixFeed(),
    bookRepository: overrides.bookRepository ?? createInMemoryBookRepository(),
    ...(overrides.nextId !== undefined ? { nextId: overrides.nextId } : {}),
    ...(overrides.now !== undefined ? { now: overrides.now } : {}),
  });
}
