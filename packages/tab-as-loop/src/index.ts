/**
 * `@borjie/tab-as-loop` — public surface.
 *
 * Wave M5. Every tab (admin / owner / worker / customer; composer /
 * workflow / dashboard / insight) is a server-anchored loop. Closing
 * the tab pauses the loop. Reopening — even on a different device —
 * rehydrates from the last committed snapshot + every newer event.
 *
 * Source of truth:
 *   - Docs/DESIGN/TAB_AS_LOOP_SPEC.md §12-19
 *   - packages/database/drizzle/0036_tab_as_loop.sql
 *
 * Public modules:
 *   - types          — TabSession, TabState, TabEvent, TabDelta, TabKind
 *                       + repository contracts
 *   - lifecycle      — pure state machine + helpers
 *   - sync           — delta apply + hydrate orchestration
 *   - repositories   — in-memory + buildFreshTabSession + transitionSession
 *   - audit          — chain-link hashing
 */

// ── Types ────────────────────────────────────────────────────────────
export type {
  ApplyDeltasInput,
  ApplyDeltasResult,
  FrictionLedger,
  HintRef,
  HydrateResult,
  HydrateTabInput,
  LoopCursor,
  OpenTabInput,
  TabDelta,
  TabDeltaKind,
  TabEvent,
  TabEventRepository,
  TabKind,
  TabLifecycleState,
  TabSession,
  TabSessionRepository,
  TabState,
} from './types.js';
export {
  TAB_AS_LOOP_CONSTANTS,
  TAB_DELTA_KINDS,
  TAB_KINDS,
  TAB_LIFECYCLE_STATES,
} from './types.js';

// ── Lifecycle ────────────────────────────────────────────────────────
export {
  isTerminal,
  isWarm,
  shouldExpire,
  TabLifecycleError,
  transitionTabLifecycle,
  type InvalidTransition,
  type TabLifecycleEvent,
} from './lifecycle/tab-lifecycle.js';

// ── Sync ─────────────────────────────────────────────────────────────
export { applyDeltas, DeltaSyncError } from './sync/delta-sync.js';
export { hydrateSession, HydrateError } from './sync/hydrate.js';

// ── Repositories ─────────────────────────────────────────────────────
export {
  buildFreshTabSession,
  createInMemoryTabSessionRepository,
  transitionSession,
} from './repositories/tab-session.js';
export {
  createInMemoryTabEventRepository,
} from './repositories/tab-event.js';

// ── Audit ────────────────────────────────────────────────────────────
export {
  computeTabAuditHash,
  GENESIS_HASH,
} from './audit/audit-chain-link.js';
