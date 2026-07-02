/**
 * Proactive-intel worker — Wave 2b (W2b).
 *
 * Lights up the DARK proactive-insight loop: the @borjie/proactive-intel
 * detectors + recommendation composer were fully built but NOTHING on the
 * live path drove them, so Mr. Mwikila never proactively surfaced an insight.
 * This worker is that driver.
 *
 * Each tick, for every ACTIVE tenant, it:
 *
 *   1. Resolves the tenant's already-fetched `TickInputs` via an injected
 *      `inputsForTenant` provider (the detectors are PURE — they never do
 *      I/O, so the I/O lives in the provider, kept injectable to stay
 *      decoupled + unit-testable; mirrors `proactive-wiring.ts`'s injected
 *      `signalSource`).
 *   2. Builds a `TickContext` and runs `runTick` over the de-duplicated
 *      union of every cadence's detector kinds (the worker IS the outer
 *      scheduler the package's docs reference, so it folds all three
 *      cadence tiers into one cadence — the cadence interval itself is
 *      this worker's interval).
 *   3. `compose()`s each produced `DetectorEvent` into a `Recommendation`.
 *   4. AFFECT-GATES the firehose (proactive-regulation win 1): reads the
 *      owner's ambient behaviour ribbon (`behaviorSignalSource.signalsForUser`)
 *      into an `InterruptionBudget` and composes it with the per-kind fatigue
 *      ratchet — so when the owner is frustrated or in flow the channel goes
 *      quiet (P2/P3 dropped, P1 deferred, P0 always through), and when they
 *      are disengaged it leans in. The affect read decays each tick so the
 *      task concern reclaims the spotlight.
 *   5. EARNS the delegation tier (proactive-regulation win 2): instead of a
 *      static severity→tier map, `resolveDelegationTier` combines the ToM
 *      trust posterior, the per-kind approval streak and owner posture to
 *      de-escalate T1→T0 ("queued, here's why") ONLY within the HITL cap
 *      (money/licence/sovereign kinds stay pinned to T1 forever; a single
 *      trust drop after a miss ratchets straight back to T1).
 *   6. Routes each surviving recommendation into the EXISTING proactive
 *      delivery sink (`publish` → `mwikila.proposes` cockpit event, the same
 *      bus the owner-web cockpit already consumes via `/api/v1/cockpit/stream`),
 *      so the insight actually reaches the cockpit.
 *
 * Both regulation organs are OPTIONALLY wired: when the behaviour source /
 * affect accumulator / owner resolver are absent the worker honest-degrades
 * to its prior publish-everything-with-the-static-tier behaviour.
 *
 * HARD RULES honoured:
 *   - Tenant-scoped: the active-tenant list is a cross-tenant read; the
 *     injected `inputsForTenant` provider owns its own tenant-scoped data
 *     access (it receives `tenantId` explicitly) so RLS FORCE holds.
 *   - Pino only (no console.log). Per-tenant failures are caught + logged;
 *     one bad tenant never tears down the tick.
 *   - Honest-degrade: no DB → inert stub; no `inputsForTenant`/`entityStore`
 *     → warn ONCE on boot then idle (never crash boot).
 *   - Cluster-leader-gated at the `index.ts` call site (via
 *     `withClusterLeader`) so only the elected replica ticks.
 *   - Tunable interval (BORJIE_PROACTIVE_INTEL_INTERVAL_MS); the timer is
 *     `unref`'d so it never holds the process open.
 *   - `tickOnce()` exposed for tests + manual triggers.
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import {
  ALL_CADENCES,
  applyFatigue,
  compose,
  readHistory,
  runTick,
  type AnomalyKind,
  type CadenceSpec,
  type EntityStore,
  type FatigueHistory,
  type OpportunityKind,
  type Recommendation,
  type RecommendationKind,
  type Severity,
  type TickContext,
  type TickInputs,
} from '@borjie/proactive-intel';

import type { CockpitEvent } from '../services/cockpit-events';
import {
  registerWorker,
  workerHeartbeat,
  workerHeartbeatFailure,
} from './worker-heartbeat';

const WORKER_NAME = 'proactive-intel';
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 min — the package's hot cadence
const MIN_INTERVAL_MS = 30 * 1000; // 30s floor
const MAX_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h ceiling
const DEFAULT_TENANT_LIMIT = 500;
/** ToM `AFFECTIVE_DEFAULT.trust` — the neutral prior when no profile exists. */
const AFFECT_NEUTRAL_TRUST = 0.6;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

/**
 * Provider that returns the already-fetched `TickInputs` for one tenant.
 *
 * The proactive-intel detectors are pure (no I/O), so all the data-fetching
 * lives HERE, behind an injectable seam. Returning empty/partial inputs is
 * the normal idle case — each detector self-skips when its slice is absent
 * (`if (!ctx.inputs.cashflow) return []`), so a thin provider degrades to a
 * no-detection tick rather than a crash.
 *
 * Kept injectable so this worker stays decoupled from the (separately wired)
 * forecasting / arrears / churn stacks and is unit-testable with a stub.
 */
export interface ProactiveIntelInputsProvider {
  inputsForTenant(input: {
    readonly tenantId: string;
    readonly nowMs: number;
  }): Promise<TickInputs>;
}

// ────────────────────────────────────────────────────────────────────
// Affect-gated interruption + earned-trust autonomy — the two
// proactive-regulation organs threaded into the worker.
//
// All three readers below are OPTIONAL. When a reader is absent the
// worker honest-degrades to its pre-existing behaviour: every
// composed recommendation publishes with the STATIC severity→tier
// map. With them wired the firehose goes quiet under frustration /
// flow, leans in under disengagement, and the delegation tier earns
// its way down to T0 on measured trust (never past the HITL cap).
// ────────────────────────────────────────────────────────────────────

/** One ambient behaviour signal (a duck-typed subset of the ai-copilot kind). */
export interface ProactiveBehaviorSignal {
  readonly kind:
    | 'engagement.high'
    | 'engagement.low'
    | 'frustration.detected'
    | 'task.completed-without-AI'
    | 'dwell.deep';
  readonly route: string;
  readonly capturedAt: string;
  readonly evidence: Readonly<Record<string, number>>;
}

/**
 * Ambient behaviour-signal source (the SAME source constructed live in
 * `sovereign.ts` as `behaviorSignalSource`, today unused on the
 * proactive side). Structurally duck-typed so the worker stays free of
 * an `@borjie/ai-copilot` dep. Pure read — returns [] on any miss, so a
 * sensorium fault degrades the gate to "normal budget", never a crash.
 */
export interface ProactiveBehaviorSignalSource {
  signalsForUser(args: {
    readonly tenantId: string;
    readonly userId: string;
    readonly windowMinutes?: number;
  }): Promise<ReadonlyArray<ProactiveBehaviorSignal>>;
}

/** Running affective state (a duck-typed subset of the kernel ToM profile). */
export interface ProactiveAffectiveProfile {
  readonly state: { readonly trust: number };
  readonly turns: number;
}

/**
 * ToM affective accumulator READ side (`createAffectiveAccumulator().read`).
 * Carries the per-(tenant,user) trust posterior the earned-trust resolver
 * reads. Optional — when absent, trust is treated as neutral (no escalation
 * past the static map).
 */
export interface ProactiveAffectReader {
  /**
   * Read the per-(tenant,user) trust posterior. MAY return a Promise: the
   * production binding (index.ts) HYDRATES the durable `affective_profiles`
   * row into the shared accumulator's cache BEFORE reading, so a fresh replica
   * / cold worker reads the persisted posterior instead of an always-empty
   * in-memory cache (migration 0372 continuity). Fail-safe: the binding
   * degrades to a memory-only read (honest null) on any store fault.
   */
  read(
    tenantId: string,
    userId: string,
    nowMs?: number,
  ): ProactiveAffectiveProfile | null | Promise<ProactiveAffectiveProfile | null>;
}

/** Owner decision/risk posture, the owner-style `posture` dimension. */
export type ProactivePosture = 'cautious' | 'balanced' | 'bold';

/**
 * Owner-style posture reader. Reads the (cautious|balanced|bold) headline
 * of the owner-style profile. Optional — absent → 'balanced' (neutral).
 */
export interface ProactivePostureReader {
  postureForTenant(tenantId: string): Promise<ProactivePosture>;
}

/**
 * Resolves the owner user-id the affect/trust readers key on. The worker
 * is tenant-scoped but affect + trust are per-user; this maps a tenant to
 * its primary owner. Absent → the affect gate + trust resolver are skipped
 * for that tenant (publish-normal with the static tier).
 */
export interface ProactiveOwnerResolver {
  ownerForTenant(tenantId: string): Promise<string | null>;
}

export interface ProactiveIntelWorkerOptions {
  readonly db: DbLike;
  readonly logger: Logger;
  /**
   * Resolves the live `TickInputs` per tenant. Omitted → the worker idles
   * (warns once on boot) because the detectors would have nothing to read.
   */
  readonly inputsForTenant?: ProactiveIntelInputsProvider | null;
  /**
   * The entity-store the tick-runner persists detected events to (the MD's
   * blackboard). Omitted → events are composed + delivered but not persisted
   * (warn once). A real store makes re-detection idempotent across ticks.
   */
  readonly entityStore?: EntityStore | null;
  /**
   * Cockpit delivery sink. Defaults to the in-process cockpit bus
   * (`publishCockpitEvent`) wired by `index.ts`; injectable so tests can
   * assert on what reaches the cockpit without standing up the bus.
   */
  readonly publish: (event: CockpitEvent) => number;
  readonly intervalMs?: number;
  readonly enabled?: boolean;
  readonly now?: () => Date;
  /** Cap tenants scanned per tick (defence against a huge tenant table). */
  readonly tenantLimit?: number;
  /**
   * Ambient behaviour-signal source (the live `behaviorSignalSource` from
   * `sovereign.ts`). Drives the affect-gated interruption budget. Omitted →
   * no affect gate (every recommendation passes to the fatigue/tier stage).
   */
  readonly behaviorSignalSource?: ProactiveBehaviorSignalSource | null;
  /**
   * ToM affective accumulator read side. Supplies the per-owner trust
   * posterior the earned-trust tier resolver reads. Omitted → neutral trust.
   */
  readonly affectReader?: ProactiveAffectReader | null;
  /**
   * Owner-style posture reader (cautious|balanced|bold). Owner-style's first
   * live consumer. Omitted → 'balanced'.
   */
  readonly postureReader?: ProactivePostureReader | null;
  /**
   * Resolves the per-tenant owner user-id the affect/trust readers key on.
   * Omitted → the affect gate + trust resolver are skipped (publish-normal).
   */
  readonly ownerResolver?: ProactiveOwnerResolver | null;
  /**
   * Entity-store backing the per-(tenant,kind) fatigue ledger (approved/
   * declined/ignored history). Defaults to `entityStore` when that is a real
   * store. Omitted/no-op → the fatigue ratchet sees an empty history (emit).
   */
  readonly fatigueStore?: EntityStore | null;
}

export interface ProactiveIntelWorkerHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<ProactiveIntelTickResult>;
}

export interface ProactiveIntelTickResult {
  /** Active tenants scanned this tick. */
  readonly tenants: number;
  /** Detector events produced across all tenants. */
  readonly detected: number;
  /** Recommendations delivered onto the cockpit bus. */
  readonly delivered: number;
  /** Tenants whose tick threw (isolated — the loop continued). */
  readonly failed: number;
}

function clampInterval(value: number): number {
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(value)));
}

function resolveIntervalMs(override?: number): number {
  const envRaw = process.env.BORJIE_PROACTIVE_INTEL_INTERVAL_MS?.trim();
  const envNum = envRaw ? Number(envRaw) : NaN;
  const candidate =
    typeof override === 'number' && Number.isFinite(override) && override > 0
      ? override
      : Number.isFinite(envNum) && envNum > 0
        ? envNum
        : DEFAULT_INTERVAL_MS;
  return clampInterval(candidate);
}

function rowsOf(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

/**
 * The de-duplicated union of every cadence's anomaly + opportunity kinds.
 * The worker is the outer scheduler, so it runs ALL declared detectors each
 * tick; the registry's `if (!fn) continue;` cleanly skips kinds that are
 * declared in a cadence but not yet shipped. Derived from `ALL_CADENCES`
 * (NOT hardcoded) so adding a detector to a cadence flows through for free.
 */
const UNION_CADENCE: CadenceSpec = {
  // `tier` is only echoed back by `runTick` into its result; the worker
  // collapses all three real tiers into one pass, so we reuse 'hot' as a
  // valid `CadenceTier` label rather than inventing a new one.
  tier: 'hot',
  intervalMs: DEFAULT_INTERVAL_MS,
  anomalyKinds: [
    ...new Set<AnomalyKind>(ALL_CADENCES.flatMap((c) => c.anomalyKinds)),
  ],
  opportunityKinds: [
    ...new Set<OpportunityKind>(ALL_CADENCES.flatMap((c) => c.opportunityKinds)),
  ],
};

/**
 * No-op entity store — used when no real store is injected so `runTick`
 * still composes + returns events (delivery is unaffected; only the
 * cross-tick blackboard persistence is skipped).
 */
const NOOP_ENTITY_STORE: EntityStore = {
  async read() {
    return null;
  },
  async write(input) {
    const stampedAt = new Date(0).toISOString();
    return {
      ...input,
      version: 0,
      createdAt: stampedAt,
      updatedAt: stampedAt,
    };
  },
  async list() {
    return [];
  },
  async delete() {
    /* no-op */
  },
};

/** Delegation tier on the `mwikila.proposes` contract. */
type DelegationTier = 'T0' | 'T1' | 'T2' | 'T3';

/**
 * The STATIC severity→tier map — the pre-existing behaviour, now the
 * FALLBACK the trust-aware resolver de-escalates from (never escalates
 * past). P0/P1 → T1 (owner sign-off expected fast); P2/P3 → T0 (FYI /
 * queued). Kept pure + named so the resolver and the honest-degrade path
 * share one source of truth.
 */
function staticTierForSeverity(severity: Severity): DelegationTier {
  return severity === 'P0' || severity === 'P1' ? 'T1' : 'T0';
}

/**
 * Map a composed `Recommendation` onto the existing `mwikila.proposes`
 * cockpit event — the bus surface the owner-web cockpit already renders for
 * "Mr. Mwikila has drafted a proposal awaiting your approval". A null
 * tenantId (platform-internal scope) is dropped: the cockpit event is
 * tenant-scoped by contract. `delegationTier` is resolved upstream (the
 * earned-trust resolver) so this stays a pure projection.
 */
function recommendationToCockpitEvent(
  rec: Recommendation,
  nowIso: string,
  delegationTier: DelegationTier,
): CockpitEvent | null {
  if (!rec.tenantId) return null;
  return {
    kind: 'mwikila.proposes',
    tenantId: rec.tenantId,
    emittedAt: nowIso,
    actionId: rec.id,
    actionKind: `proactive-intel.${rec.type}.${rec.kind}`,
    category: rec.type,
    delegationTier,
    summary: rec.summary,
  };
}

// ════════════════════════════════════════════════════════════════════
// WIN 1 — Affect-gated interruption.
//
// A pure `deriveInterruptionBudget(signals)` turns the ambient behaviour
// ribbon into an interruption posture that decides, per recommendation,
// whether to EMIT, DEFER (hold for a later, calmer tick) or DROP. The
// posture composes with the existing fatigue ratchet (outcome history),
// so affect and outcome-history fold into ONE emit/defer/drop decision.
// ════════════════════════════════════════════════════════════════════

/** How loud the proactive channel may be this tick for this owner. */
type InterruptionPosture =
  /** Owner frustrated / deep in flow → suppress P2/P3, HOLD P1 (defer). */
  | 'quiet'
  /** No strong signal → the static behaviour. */
  | 'normal'
  /** Owner disengaged → surface ONE held/low item to re-engage. */
  | 'lean-in';

export interface InterruptionBudget {
  readonly posture: InterruptionPosture;
  /** Why this posture won — for the trace log (never owner-facing). */
  readonly reason: string;
}

/**
 * Derive the interruption budget from the ambient signal ribbon. PURE.
 *
 *   frustration.detected OR dwell.deep → quiet (defer the firehose)
 *   engagement.low                     → lean-in (re-engage with one item)
 *   else                               → normal
 *
 * frustration/flow wins over disengagement (you never lean IN on a
 * frustrated owner). Empty signals (the common case, or a sensorium
 * miss) → normal, so the gate is inert by default.
 */
export function deriveInterruptionBudget(
  signals: ReadonlyArray<ProactiveBehaviorSignal>,
): InterruptionBudget {
  const has = (k: ProactiveBehaviorSignal['kind']): boolean =>
    signals.some((s) => s.kind === k);

  if (has('frustration.detected')) {
    return { posture: 'quiet', reason: 'frustration.detected' };
  }
  if (has('dwell.deep')) {
    return { posture: 'quiet', reason: 'dwell.deep (owner in flow)' };
  }
  if (has('engagement.low')) {
    return { posture: 'lean-in', reason: 'engagement.low (disengaged)' };
  }
  return { posture: 'normal', reason: 'no strong affect signal' };
}

/** The gate's verdict for one recommendation under the budget + fatigue. */
type GateDecision = 'emit' | 'defer' | 'drop';

/**
 * Compose the affect budget with the fatigue ratchet into one verdict.
 *
 *   - The fatigue ratchet runs first (outcome-history truth). A fatigue
 *     `drop` is honoured outright — affect never resurrects a recommendation
 *     the owner has repeatedly ignored/declined.
 *   - Under a `quiet` posture: P2/P3 are dropped this tick; a P1 is DEFERRED
 *     (held, not dropped — it resurfaces on a calmer tick); P0 always emits
 *     (a fail-closed safety item is never silenced by mood).
 *   - Under `lean-in`: the budget is RAISED — a recommendation the static
 *     map would queue still emits, pulling a disengaged owner back in.
 *   - Under `normal`: the fatigue verdict stands.
 *
 * Returns the verdict plus the (possibly fatigue-adjusted) severity so the
 * caller can resolve the tier off the post-ratchet severity.
 */
export function gateRecommendation(args: {
  readonly budgetPosture: InterruptionPosture;
  readonly fatigueOutcome: 'emit' | 'drop' | 'boost' | 'downgrade';
  readonly fatigueSeverity: Severity;
}): { readonly decision: GateDecision; readonly severity: Severity } {
  const { budgetPosture, fatigueOutcome, fatigueSeverity } = args;
  const eff = fatigueSeverity;

  // Outcome-history truth wins: a fatigue drop is never overridden by affect.
  if (fatigueOutcome === 'drop') {
    return { decision: 'drop', severity: eff };
  }

  if (budgetPosture === 'quiet') {
    if (eff === 'P0') return { decision: 'emit', severity: eff };
    if (eff === 'P1') return { decision: 'defer', severity: eff };
    return { decision: 'drop', severity: eff }; // P2/P3 suppressed while quiet
  }

  // lean-in + normal both EMIT a within-tolerance recommendation; lean-in
  // simply does not let a low-severity item be dropped for being "minor",
  // which the fatigue ratchet already respects (it only drops on streaks).
  return { decision: 'emit', severity: eff };
}

// ════════════════════════════════════════════════════════════════════
// WIN 2 — Earned-trust autonomy.
//
// Replaces the static severity→tier map with a trust-aware resolver that
// combines (a) the ToM trust posterior, (b) the per-kind fatigue approval
// streak, and (c) owner-style posture — STRICTLY within the HITL-safe
// band (sovereign / money / licence kinds stay pinned to T1 forever).
// A trust drop after a miss ratchets back to T1 until the streak rebuilds.
// ════════════════════════════════════════════════════════════════════

/**
 * Recommendation kinds that are PINNED to T1 (explicit owner sign-off)
 * forever, regardless of measured trust — the autonomy cap. Anything that
 * moves money, touches a sovereign/licence obligation, or carries
 * regulatory consequence never auto-queues. Matched as a case-insensitive
 * substring over the recommendation kind so a new money/licence detector
 * inherits the cap without a code change here.
 */
const HITL_PINNED_KIND_MARKERS: ReadonlyArray<string> = [
  'royalty',
  'licence',
  'license',
  'permit',
  'payroll',
  'payout',
  'payment',
  'settlement',
  'tax',
  'compliance',
  'sovereign',
  'treasury',
  'offtake',
  'contract',
];

/** True when this recommendation kind must stay at T1 (owner sign-off). */
export function isHitlPinned(kind: RecommendationKind): boolean {
  const k = String(kind).toLowerCase();
  return HITL_PINNED_KIND_MARKERS.some((m) => k.includes(m));
}

/**
 * The length of the leading consecutive run of `approved` outcomes in the
 * fatigue history (newest-first). Mirrors the fatigue ratchet's own
 * approval-streak notion (3+ = trust boost) but exposed for the tier
 * resolver. A single non-approval breaks the streak → 0.
 */
export function approvalStreakOf(history: FatigueHistory): number {
  let n = 0;
  for (const outcome of history.recent) {
    if (outcome === 'approved') n += 1;
    else break;
  }
  return n;
}

/** Trust thresholds: posture shifts how much measured trust autonomy buys. */
const TRUST_AUTONOMY_FLOOR = 0.7; // below this, never auto-queue a T1-by-severity item
const APPROVAL_STREAK_FLOOR = 3; // 3+ consecutive approvals on this kind

/**
 * Resolve the delegation tier — the earned-trust core. PURE.
 *
 * Starts from the STATIC map (the autonomy cap on escalation) and only
 * ever DE-ESCALATES T1→T0 ("I queued it, here's why") when ALL hold:
 *   - the kind is not HITL-pinned (money/licence/sovereign stay T1), AND
 *   - measured trust ≥ floor (posture lowers/raises the floor:
 *     bold owners grant autonomy sooner, cautious owners later), AND
 *   - the per-kind approval streak ≥ floor.
 *
 * It NEVER returns a tier "louder" than the static map would (no
 * P2→T1 escalation), and it NEVER lifts a pinned kind off T1. A trust
 * value below the floor (e.g. just dropped 0.15 after a miss) collapses
 * the resolver straight back to the static tier — the de-escalation
 * after a miss the spec calls for.
 */
export function resolveDelegationTier(args: {
  readonly severity: Severity;
  readonly kind: RecommendationKind;
  readonly trust: number;
  readonly approvalStreak: number;
  readonly posture: ProactivePosture;
}): DelegationTier {
  const { severity, kind, trust, approvalStreak, posture } = args;
  const staticTier = staticTierForSeverity(severity);

  // Cap: pinned kinds and already-T0 items are never re-tiered upward.
  if (staticTier === 'T0') return 'T0';
  if (isHitlPinned(kind)) return 'T1';

  // Posture tilts the trust floor: bold → earns autonomy sooner; cautious
  // → later. Balanced uses the base floor. (Clamped so the floor stays sane.)
  const postureDelta =
    posture === 'bold' ? -0.1 : posture === 'cautious' ? +0.1 : 0;
  const effectiveFloor = Math.min(0.95, Math.max(0.55, TRUST_AUTONOMY_FLOOR + postureDelta));

  const earned = trust >= effectiveFloor && approvalStreak >= APPROVAL_STREAK_FLOOR;
  // Earned → present as "done/queued, here's why" (T0); else owner sign-off (T1).
  return earned ? 'T0' : 'T1';
}

/** Active tenant ids — cross-tenant read, mirrors proactive-wiring.ts. */
async function listActiveTenantIds(
  db: DbLike,
  logger: Logger,
  limit: number,
): Promise<readonly string[]> {
  try {
    const res = await db.execute(
      sql`SELECT id FROM tenants WHERE status = 'active' LIMIT ${limit}`,
    );
    return rowsOf(res)
      .map((r) => r.id)
      .filter((id): id is string => typeof id === 'string');
  } catch (err) {
    logger.warn(
      { worker: WORKER_NAME, err: err instanceof Error ? err.message : String(err) },
      'proactive-intel: listActiveTenantIds failed; degrading to []',
    );
    return [];
  }
}

export function createProactiveIntelWorker(
  options: ProactiveIntelWorkerOptions,
): ProactiveIntelWorkerHandle {
  const intervalMs = resolveIntervalMs(options.intervalMs);
  const now = options.now ?? (() => new Date());
  const enabled = options.enabled !== false;
  const tenantLimit = Math.min(
    2000,
    Math.max(1, options.tenantLimit ?? DEFAULT_TENANT_LIMIT),
  );
  const inputsProvider = options.inputsForTenant ?? null;
  const entityStore = options.entityStore ?? NOOP_ENTITY_STORE;
  // Proactive-regulation organs (both wins). All optional — when absent the
  // worker degrades to the pre-existing publish-everything-with-static-tier
  // behaviour. The fatigue ledger reuses the entity store when none is given.
  const behaviorSignalSource = options.behaviorSignalSource ?? null;
  const affectReader = options.affectReader ?? null;
  const postureReader = options.postureReader ?? null;
  const ownerResolver = options.ownerResolver ?? null;
  const fatigueStore = options.fatigueStore ?? options.entityStore ?? null;
  // The affect gate + earned-trust resolver both key on the owner user-id.
  // Without an owner resolver we cannot read affect/trust, so both organs
  // are inert (publish-normal, static tier) for the tenant.
  const regulationLive = Boolean(ownerResolver) &&
    (Boolean(behaviorSignalSource) || Boolean(affectReader));

  let timer: ReturnType<typeof setInterval> | null = null;
  let bootWarned = false;

  function warnBootOnce(): void {
    if (bootWarned) return;
    bootWarned = true;
    if (!inputsProvider) {
      options.logger.warn(
        { worker: WORKER_NAME },
        'proactive-intel: no inputs provider wired — detectors will idle until one is injected',
      );
    }
    if (!options.entityStore) {
      options.logger.warn(
        { worker: WORKER_NAME },
        'proactive-intel: no entity store wired — events composed + delivered but not persisted across ticks',
      );
    }
    if (!regulationLive) {
      options.logger.warn(
        {
          worker: WORKER_NAME,
          hasBehaviorSignalSource: Boolean(behaviorSignalSource),
          hasAffectReader: Boolean(affectReader),
          hasOwnerResolver: Boolean(ownerResolver),
        },
        'proactive-intel: affect-gate / earned-trust readers not fully wired — ' +
          'publishing with the static severity→tier map (no affect throttling, no earned autonomy)',
      );
    }
  }

  /**
   * Resolve the per-tenant proactive-regulation context ONCE per tick:
   * the owner's interruption budget (affect gate) + trust posterior +
   * posture (earned-trust resolver). Reads are best-effort — any miss
   * degrades to a neutral context (normal budget, neutral trust, balanced
   * posture) so the tenant still publishes with the static tier.
   */
  async function resolveRegulationContext(
    tenantId: string,
    nowMs: number,
  ): Promise<{
    readonly budget: InterruptionBudget;
    readonly trust: number;
    readonly posture: ProactivePosture;
  }> {
    const neutral = {
      budget: { posture: 'normal' as const, reason: 'regulation organs not wired' },
      trust: AFFECT_NEUTRAL_TRUST,
      posture: 'balanced' as ProactivePosture,
    };
    if (!regulationLive || !ownerResolver) return neutral;

    let ownerId: string | null = null;
    try {
      ownerId = await ownerResolver.ownerForTenant(tenantId);
    } catch (err) {
      options.logger.debug(
        { worker: WORKER_NAME, tenantId, err: errMsg(err) },
        'proactive-intel: ownerForTenant failed; neutral regulation context',
      );
      return neutral;
    }
    if (!ownerId) return neutral;

    // Affect gate — the ambient behaviour ribbon → interruption budget.
    let budget = neutral.budget as InterruptionBudget;
    if (behaviorSignalSource) {
      try {
        const signals = await behaviorSignalSource.signalsForUser({
          tenantId,
          userId: ownerId,
        });
        budget = deriveInterruptionBudget(signals);
      } catch (err) {
        options.logger.debug(
          { worker: WORKER_NAME, tenantId, err: errMsg(err) },
          'proactive-intel: signalsForUser failed; normal budget',
        );
      }
    }

    // Trust posterior — ToM accumulator read. The production binding hydrates
    // the durable `affective_profiles` row into the shared accumulator's cache
    // before reading (may return a Promise), so a cold worker reads the
    // persisted posterior rather than an always-empty in-memory cache.
    let trust = AFFECT_NEUTRAL_TRUST;
    if (affectReader) {
      try {
        const profile = await affectReader.read(tenantId, ownerId, nowMs);
        if (profile && profile.turns >= 1) trust = profile.state.trust;
      } catch (err) {
        options.logger.debug(
          { worker: WORKER_NAME, tenantId, err: errMsg(err) },
          'proactive-intel: affectReader.read failed; neutral trust',
        );
      }
    }

    // Owner-style posture — its first live consumer.
    let posture: ProactivePosture = 'balanced';
    if (postureReader) {
      try {
        posture = await postureReader.postureForTenant(tenantId);
      } catch (err) {
        options.logger.debug(
          { worker: WORKER_NAME, tenantId, err: errMsg(err) },
          'proactive-intel: postureForTenant failed; balanced posture',
        );
      }
    }

    return { budget, trust, posture };
  }

  /**
   * Run the full detector pipeline for one tenant and deliver every
   * resulting recommendation. Returns the per-tenant counts. NEVER throws —
   * the caller increments `failed` on a rejected promise, but every internal
   * fault is already contained here.
   */
  async function runForTenant(
    tenantId: string,
    nowMs: number,
    nowIso: string,
  ): Promise<{ detected: number; delivered: number }> {
    let inputs: TickInputs;
    try {
      inputs = inputsProvider
        ? await inputsProvider.inputsForTenant({ tenantId, nowMs })
        : {};
    } catch (err) {
      options.logger.warn(
        {
          worker: WORKER_NAME,
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'proactive-intel: inputsForTenant failed; treating tenant as no-signal',
      );
      inputs = {};
    }

    const ctx: TickContext = {
      scope: 'tenant',
      tenantId,
      nowMs,
      inputs,
    };

    let events;
    try {
      const result = await runTick(ctx, UNION_CADENCE, entityStore);
      events = [...result.anomalies, ...result.opportunities];
    } catch (err) {
      options.logger.warn(
        {
          worker: WORKER_NAME,
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'proactive-intel: runTick failed for tenant',
      );
      return { detected: 0, delivered: 0 };
    }

    // Resolve the affect budget + trust posterior + posture ONCE for the
    // whole tenant tick (a single owner read), then gate each recommendation.
    const regCtx = await resolveRegulationContext(tenantId, nowMs);

    let delivered = 0;
    for (const event of events) {
      // compose is a pure, idempotent DetectorEvent → Recommendation map.
      const rec = compose(event);
      if (!rec.tenantId) continue; // platform-internal scope — cockpit is tenant-scoped

      // ── Fatigue ratchet (outcome history) ────────────────────────────
      // Read the per-(tenant,kind) approval/decline/ignore ledger and run
      // the pure fatigue policy. This is the outcome-history half of the
      // emit/defer/drop decision and supplies the post-ratchet severity.
      let fatigueOutcome: 'emit' | 'drop' | 'boost' | 'downgrade' = 'emit';
      let fatigueSeverity: Severity = rec.severity;
      let approvalStreak = 0;
      if (fatigueStore) {
        try {
          const history = await readHistory(
            fatigueStore,
            'tenant',
            rec.tenantId,
            rec.kind,
          );
          approvalStreak = approvalStreakOf(history);
          const decision = applyFatigue(rec, history);
          fatigueOutcome = decision.outcome;
          if (decision.recommendation) {
            fatigueSeverity = decision.recommendation.severity;
          }
        } catch (err) {
          options.logger.debug(
            { worker: WORKER_NAME, tenantId, recommendationId: rec.id, err: errMsg(err) },
            'proactive-intel: fatigue read failed; treating as emit',
          );
        }
      }

      // ── Affect gate ──────────────────────────────────────────────────
      // Compose the interruption budget with the fatigue verdict into one
      // emit/defer/drop. `defer` HOLDS the item (it is not delivered this
      // tick but is not dropped — a calmer tick will re-detect + surface it).
      const gate = gateRecommendation({
        budgetPosture: regCtx.budget.posture,
        fatigueOutcome,
        fatigueSeverity,
      });
      if (gate.decision !== 'emit') {
        options.logger.debug(
          {
            worker: WORKER_NAME,
            tenantId,
            recommendationId: rec.id,
            kind: rec.kind,
            decision: gate.decision,
            budget: regCtx.budget.posture,
            reason: regCtx.budget.reason,
            fatigueOutcome,
          },
          `proactive-intel: ${gate.decision} recommendation (affect/fatigue gate)`,
        );
        continue;
      }

      // ── Earned-trust tier ────────────────────────────────────────────
      // Resolve the delegation tier off the post-ratchet severity, the trust
      // posterior, the per-kind approval streak and owner posture — strictly
      // within the HITL cap (money/licence/sovereign stay T1).
      const delegationTier = resolveDelegationTier({
        severity: gate.severity,
        kind: rec.kind,
        trust: regCtx.trust,
        approvalStreak,
        posture: regCtx.posture,
      });

      const cockpitEvent = recommendationToCockpitEvent(rec, nowIso, delegationTier);
      if (!cockpitEvent) continue;
      try {
        options.publish(cockpitEvent);
        delivered += 1;
      } catch (err) {
        options.logger.warn(
          {
            worker: WORKER_NAME,
            tenantId,
            recommendationId: rec.id,
            err: errMsg(err),
          },
          'proactive-intel: failed to deliver recommendation to cockpit',
        );
      }
    }
    return { detected: events.length, delivered };
  }

  async function tickOnce(): Promise<ProactiveIntelTickResult> {
    warnBootOnce();
    if (!enabled) {
      return { tenants: 0, detected: 0, delivered: 0, failed: 0 };
    }
    try {
      const tNow = now();
      const nowMs = tNow.getTime();
      const nowIso = tNow.toISOString();
      const tenants = await listActiveTenantIds(options.db, options.logger, tenantLimit);
      let detected = 0;
      let delivered = 0;
      let failed = 0;
      for (const tenantId of tenants) {
        try {
          const r = await runForTenant(tenantId, nowMs, nowIso);
          detected += r.detected;
          delivered += r.delivered;
        } catch (err) {
          // Defence-in-depth: runForTenant already contains its faults, but a
          // truly unexpected throw must not abort the remaining tenants.
          failed += 1;
          options.logger.warn(
            {
              worker: WORKER_NAME,
              tenantId,
              err: err instanceof Error ? err.message : String(err),
            },
            'proactive-intel: tenant tick threw (isolated)',
          );
        }
      }
      if (delivered > 0 || failed > 0) {
        options.logger.info(
          { worker: WORKER_NAME, tenants: tenants.length, detected, delivered, failed },
          'proactive-intel: tick done',
        );
      }
      workerHeartbeat(WORKER_NAME);
      return { tenants: tenants.length, detected, delivered, failed };
    } catch (err) {
      workerHeartbeatFailure(WORKER_NAME, err);
      throw err;
    }
  }

  function start(): void {
    if (!enabled) {
      options.logger.info({ worker: WORKER_NAME }, 'proactive-intel: disabled by config');
      return;
    }
    if (timer) return;
    registerWorker({ name: WORKER_NAME, intervalMs });
    // Fire one tick on boot so the loop is visibly alive, then arm the
    // interval. void — never block start().
    void tickOnce().catch((err) => {
      options.logger.warn(
        { worker: WORKER_NAME, err: err instanceof Error ? err.message : String(err) },
        'proactive-intel: initial tick failed',
      );
    });
    timer = setInterval(() => {
      tickOnce().catch((err) => {
        options.logger.error(
          { worker: WORKER_NAME, err: err instanceof Error ? err.message : String(err) },
          'proactive-intel: tick threw',
        );
      });
    }, intervalMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    options.logger.info(
      { worker: WORKER_NAME, intervalMs },
      'proactive-intel: started',
    );
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, tickOnce };
}
