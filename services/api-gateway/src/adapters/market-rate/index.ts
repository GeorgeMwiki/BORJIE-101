/**
 * Barrel export for the market-rate adapters. Lets the composition
 * root pull all of them via a single import:
 *
 *   import { createCompositeAdapterFromEnv } from '../adapters/market-rate/index.js';
 */

export {
  RENTOMETER_ADAPTER_ID,
  createRentometerAdapter,
  createRentometerAdapterFromEnv,
  type RentometerAdapterDeps,
  type RentometerEnv,
} from './rentometer-adapter.js';

export {
  createCompositeAdapter,
  createCompositeAdapterFromEnv,
  type CompositeAdapterDeps,
  type CompositeAdapterLogger,
  type CompositeEnv,
  type CompositeMode,
} from './composite-adapter.js';
