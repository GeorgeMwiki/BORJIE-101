/**
 * `@borjie/tab-as-loop` — public type surface.
 *
 * Wave M5. Mirrors the 2-table schema in migration
 * `0036_tab_as_loop.sql`:
 *
 *   - TabSession   — a row in `tab_sessions`.
 *   - TabEvent     — a row in `tab_events`.
 *
 * Plus the lifecycle state machine value-types, the canonical
 * `TabState` envelope persisted in `tab_sessions.state`, and the
 * `TabDelta` value-types that client → server sync emits.
 *
 * Spec: Docs/DESIGN/TAB_AS_LOOP_SPEC.md §12-19.
 */

// ---------------------------------------------------------------------------
// Lifecycle states — the 6 values the state machine recognises.
// `closed` is terminal; the row stays in the table for forensic
// reasons but is no longer hydratable.
// ---------------------------------------------------------------------------

export type TabLifecycleState =
  | 'opening'
  | 'hydrating'
  | 'active'
  | 'paused'
  | 'expiring'
  | 'closed';

export const TAB_LIFECYCLE_STATES: ReadonlyArray<TabLifecycleState> = [
  'opening',
  'hydrating',
  'active',
  'paused',
  'expiring',
  'closed',
] as const;

// ---------------------------------------------------------------------------
// Tab kinds — the audience-shaped tabs the platform exposes plus the
// loop-pattern classifiers from §6.
// ---------------------------------------------------------------------------

export type TabKind =
  | 'composer'
  | 'workflow'
  | 'dashboard'
  | 'insight'
  | 'admin'
  | 'owner'
  | 'worker'
  | 'customer';

export const TAB_KINDS: ReadonlyArray<TabKind> = [
  'composer',
  'workflow',
  'dashboard',
  'insight',
  'admin',
  'owner',
  'worker',
  'customer',
] as const;

// ---------------------------------------------------------------------------
// TabState — the canonical jsonb envelope persisted in
// `tab_sessions.state`. Every field is readonly; updates always produce
// a new value (immutable). §14 of the spec.
// ---------------------------------------------------------------------------

export interface LoopCursor {
  readonly iteration: number;
  readonly lastSensorAt: string; // ISO 8601
  readonly lastPolicyVerdict: 'allow' | 'deny' | 'review';
}

export interface FrictionLedger {
  readonly score: number; // 0..1
  readonly samples: number;
}

export interface HintRef {
  readonly hintId: string;
  readonly emittedAt: string; // ISO
  readonly acknowledged: boolean;
}

export interface TabState {
  readonly recipeId: string;
  readonly recipeVersion: number;
  readonly scopeId: string | null;
  readonly uiState: Readonly<Record<string, unknown>>;
  readonly loopCursor: LoopCursor;
  readonly pendingHints: ReadonlyArray<HintRef>;
  readonly frictionLedger: FrictionLedger;
  readonly recipeProposals: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// TabSession — one row in `tab_sessions`.
// ---------------------------------------------------------------------------

export interface TabSession {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly tabKind: TabKind;
  readonly state: TabState;
  readonly lifecycleState: TabLifecycleState;
  readonly openedAt: Date;
  readonly pausedAt: Date | null;
  readonly expiresAt: Date;
  readonly auditHash: string;
  readonly prevHash: string;
}

// ---------------------------------------------------------------------------
// TabDelta — the client → server patch.
// One delta per inner loop iteration or per user gesture. Each kind
// carries a typed payload. Stored in `tab_events`.
// ---------------------------------------------------------------------------

export type TabDeltaKind =
  | 'ui.field-edit'
  | 'loop.iteration-done'
  | 'hint.acknowledge'
  | 'friction.sample'
  | 'recipe.proposal'
  | 'lifecycle.transition';

export const TAB_DELTA_KINDS: ReadonlyArray<TabDeltaKind> = [
  'ui.field-edit',
  'loop.iteration-done',
  'hint.acknowledge',
  'friction.sample',
  'recipe.proposal',
  'lifecycle.transition',
] as const;

export interface TabDelta {
  readonly kind: TabDeltaKind;
  /** Monotonic client-side iteration counter. Used to detect rebase. */
  readonly clientIteration: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// TabEvent — one row in `tab_events`. Persisted form of a TabDelta
// (after the server has applied + validated + audit-hashed it).
// ---------------------------------------------------------------------------

export interface TabEvent {
  readonly id: string;
  readonly tabSessionId: string;
  readonly tenantId: string;
  readonly eventKind: TabDeltaKind;
  readonly iteration: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly recordedAt: Date;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// Inputs — caller-facing shapes
// ---------------------------------------------------------------------------

export interface OpenTabInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly tabKind: TabKind;
  readonly initialState: TabState;
  readonly ttlMs?: number;
}

export interface HydrateTabInput {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly clientIteration: number;
}

export interface HydrateResult {
  readonly session: TabSession;
  readonly snapshotIteration: number;
  readonly eventsApplied: number;
}

export interface ApplyDeltasInput {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly fromIteration: number;
  readonly deltas: ReadonlyArray<TabDelta>;
}

export interface ApplyDeltasResult {
  readonly session: TabSession;
  readonly persistedEvents: ReadonlyArray<TabEvent>;
  readonly rebase: TabState | null;
}

// ---------------------------------------------------------------------------
// Repository contracts
// ---------------------------------------------------------------------------

export interface TabSessionRepository {
  insert(session: TabSession): Promise<TabSession>;
  findById(tenantId: string, id: string): Promise<TabSession | null>;
  listOpenForUser(
    tenantId: string,
    userId: string,
  ): Promise<ReadonlyArray<TabSession>>;
  replace(session: TabSession): Promise<void>;
  listExpiring(now: Date): Promise<ReadonlyArray<TabSession>>;
}

export interface TabEventRepository {
  append(event: TabEvent): Promise<TabEvent>;
  listForSession(
    tenantId: string,
    sessionId: string,
    fromIterationExclusive: number,
  ): Promise<ReadonlyArray<TabEvent>>;
}

// ---------------------------------------------------------------------------
// Constants — visible to lifecycle, sync, and repos.
// ---------------------------------------------------------------------------

export const TAB_AS_LOOP_CONSTANTS = {
  /** Default lifetime for a freshly opened tab session. */
  DEFAULT_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  /** Default pause grace before the row is eligible for expiry sweep. */
  PAUSE_GRACE_MS: 5 * 60 * 1000,
  /** Maximum number of deltas a single apply call may carry. */
  MAX_DELTAS_PER_APPLY: 256,
} as const;
