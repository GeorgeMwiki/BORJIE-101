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

// ───────────────────────────────────────────────────────────────────────
// Situational awareness — the per-tenant six-facet standing brief
// { happened, doing, toDo, couldMatterLater, blindSpots, caveats }.
// Read FIRST each turn (re-orientation ritual). ADDITIVE + READ-ONLY:
// synthesized from injected memory/audit/workflow ports; never writes
// source state, the audit chain, or the money path; INFORMS, never gates.
// ───────────────────────────────────────────────────────────────────────
export { buildStandingBrief } from './situation/standing-brief.js';
export type { BuildBriefContext } from './situation/standing-brief.js';
export { briefForBrainContext } from './situation/brain-context.js';
export type { BrainContextProjection } from './situation/brain-context.js';
export { salience, DEFAULT_HALF_LIFE_HOURS } from './situation/salience.js';
export type { SalienceInput, SalienceContext } from './situation/salience.js';
export type {
  StandingBrief,
  BriefItem,
  FutureItem,
  BlindSpot,
  Caveat,
  BriefEvidence,
} from './situation/brief-types.js';
export {
  standingBriefSchema,
  briefItemSchema,
  futureItemSchema,
  blindSpotSchema,
  caveatSchema,
  briefEvidenceSchema,
} from './situation/brief-types.js';
export type {
  BriefSources,
  HappenedRecord,
  DoingRecord,
  ToDoRecord,
  FutureRecord,
  BlindSpotRecord,
} from './situation/brief-ports.js';
