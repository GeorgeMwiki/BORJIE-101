/**
 * @borjie/ussd-engine — public API (LP-25).
 *
 * Pure USSD menu-tree + session state machine for feature-phone miners.
 * Wire it at the api-gateway composition root by injecting a session store,
 * an identity resolver, and the read-only data fetchers, then call
 * `handleUssdRequest` from the Africa's-Talking webhook route.
 *
 * @module @borjie/ussd-engine
 */

export * from './types.js';
export * from './ports.js';

export {
  buildMenuTree,
  buildMainMenu,
  buildLicenceScreen,
  buildNoLicenceScreen,
  buildRoyaltyScreen,
  buildNoRoyaltyScreen,
  buildProductionLogPrompt,
  buildProductionLogConfirm,
  buildProductionLoggedScreen,
  buildPayoutScreen,
  buildNoPayoutScreen,
  buildMarketplaceScreen,
  buildLanguageMenu,
  buildLanguageSetScreen,
  buildErrorScreen,
  truncateToUssd,
  tierSatisfies,
  type UssdErrorCode,
} from './menu-tree.js';

export {
  handleUssdRequest,
  extractLatestInput,
  type UssdEngineDeps,
} from './session-machine.js';

export {
  createInMemorySessionStore,
  type InMemoryStoreOptions,
} from './in-memory-store.js';
