/**
 * `@borjie/brain-llm-router/price-book` — public surface.
 *
 * The ONE USD-per-1K-token model price table (cost telemetry only —
 * never routing). See `./price-book.ts` for the contract.
 */

export {
  createPriceBook,
  getDefaultPriceBook,
  ANTHROPIC_PRICE_RATES,
  PRICE_BOOK_FALLBACK_RATES,
  DEFAULT_PRICE_RATE_ID,
  type ModelPriceRate,
  type PriceBook,
  type PriceBookSource,
  type PriceBookLogger,
} from './price-book.js';
