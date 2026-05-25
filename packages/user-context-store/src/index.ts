/**
 * `@borjie/user-context-store` — public barrel.
 *
 * Headline consumer:
 *   createUserContextDataPort({ db, embedder, audit, index })
 *
 * The advisor (P7) only needs the headline; the rest of the exports
 * are for the composition root and for tests.
 */

// Types — re-export the entire contract so consumers don't import
// './types.js' directly. P7 imports its DataPort shape from here.
export * from './types.js';

// Headline.
export {
  createUserContextDataPort,
  type CreateUserContextDataPortArgs,
} from './data-port.js';

// Profiles.
export {
  buildProfile,
  buildTenantProfile,
  buildOwnerProfile,
  buildPMProfile,
  buildEstateMgrProfile,
  buildAdminProfile,
  buildProspectProfile,
} from './profile/index.js';

// Signals.
export {
  gatherSignals,
  intentSignals,
  lifecycleStage,
  openItems,
  recentActivity,
} from './signals/index.js';

// Triggers.
export {
  computeTriggers,
  ALL_TRIGGER_RULES,
  triggerKey,
  type TriggerRule,
} from './triggers/index.js';

// Search.
export {
  searchScoped,
  createMockEmbedder,
  createOpenAIEmbedder,
  InMemoryCorpusIndex,
} from './search/index.js';

// Privacy.
export { consentCheck, minimizePII } from './privacy/index.js';

// Audit.
export {
  createWormAuditContextSink,
  nullAuditSink,
  type WormAuditStore,
} from './audit/index.js';
