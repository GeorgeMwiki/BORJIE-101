/**
 * Control-shell wiring — composition root (Wave 1 conductor, OK-3).
 *
 * Gives the orphan blackboard control shell
 * (`@borjie/blackboard-sota` control/control-shell.ts:createControlShell)
 * its FIRST runtime caller. The control shell is the Hayes-Roth 1985
 * metalevel scheduler: given a region snapshot + the candidate
 * KnowledgeSources + a competence lookup, it returns the single KS to
 * activate next (priority × freshness × competence), or `null` if nothing
 * scores above the dormant floor.
 *
 * THIS MODULE BINDS THREE SEAMS
 * ─────────────────────────────
 *   1. `CompetenceLookupPort` over `@borjie/capability-catalogue`'s
 *      measurement aggregator (`aggregateMeasurement`). When a measurement
 *      source is wired it returns the measured `competenceRate`; when not
 *      (today's default) it returns `null` so the shell falls back to 0.5
 *      internally (spec §3.2).
 *   2. `KSActivityClockPort` — Δt-since-last-spoke per (ks, region). The
 *      default in-memory clock returns `null` (never spoke → fully fresh),
 *      and `noteActivation(...)` lets a caller record an activation so a
 *      re-pick decays it.
 *   3. The DELTA TRIGGER — `onSlotConverged(slot)` maps a converged
 *      blackboard slot (`@borjie/blackboard-sota` Slot) into a Region +
 *      candidate KnowledgeSources and calls `pickNext`. `start(tenantId)`
 *      subscribes to remote SLOT_DELTA_EVENTs via `getSlotStore().connect`
 *      so a cross-surface convergence also schedules.
 *
 * HARD RULES (doctrine)
 * ─────────────────────
 *   - ADDITIVE: this module is NOT consumed by the default `/ask` turn
 *     path. It schedules over blackboard region deltas only; until a
 *     caller routes a `ControlActivation` to a KnowledgeSource (a separate
 *     wire) it is propose-only.
 *   - FAIL-SAFE: the whole pickNext-on-delta is wrapped in try/catch so a
 *     control-shell fault NEVER breaks the state-bus / slot path.
 *   - AUDIT-PLANE ONLY: a `ControlActivation` is logged + handed to the
 *     injected `onActivation` sink; it is NEVER returned to a client.
 *   - DEFAULT-ON kill-switch on `BORJIE_CONTROL_SHELL` (operator-env-only);
 *     only an explicit off/0/false/no disables the delta scheduler.
 *   - BUDGET BOUND: a per-tenant min-interval (`BORJIE_CONTROL_SHELL_MIN_MS`)
 *     coalesces a delta storm so the scheduler cannot thrash.
 *
 * No `console.*` (Pino shim only). No `process.env` read outside the
 * `resolve*` helpers called once at construction.
 */

import {
  createControlShell,
  BLACKBOARD_CONSTANTS,
  type ControlShell,
  type CompetenceLookupPort,
  type KSActivityClockPort,
  type ControlActivation,
  type KnowledgeSource,
  type KnowledgeSourceKind,
  type Region,
  type RegionKind,
  type Slot,
  type SlotsRepository,
} from '@borjie/blackboard-sota';
import {
  aggregateMeasurement,
  type Invocation,
  type Outcome,
} from '@borjie/capability-catalogue';
import { sql } from 'drizzle-orm';
import { withTenantContext } from '@borjie/database';

import type { PinoLikeLogger } from '../utils/pino-shim.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';
import {
  getSlotStore,
  getSlotsRepository,
} from './blackboard-slots-wiring.js';

// ---------------------------------------------------------------------------
// Config (read once at construction; operator-env-only kill-switch).
// ---------------------------------------------------------------------------

const DEFAULT_MIN_INTERVAL_MS = 1_000; // coalesce a delta storm (budget bound)

function resolveEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const raw = (env.BORJIE_CONTROL_SHELL ?? 'on').trim().toLowerCase();
  return !['off', '0', 'false', 'no'].includes(raw);
}

function resolveMinIntervalMs(
  env: Readonly<Record<string, string | undefined>>,
): number {
  const raw = env.BORJIE_CONTROL_SHELL_MIN_MS?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MIN_INTERVAL_MS;
}

// ---------------------------------------------------------------------------
// 1. CompetenceLookupPort over the capability-catalogue measurement.
// ---------------------------------------------------------------------------

/**
 * Supplies the raw invocation / outcome streams for a capability so the
 * competence port can aggregate a measured competence rate. When omitted
 * the competence port returns `null` and the control shell falls back to
 * 0.5 internally (spec §3.2). Implementations scan the durable capability
 * stores; tests inject a deterministic stub.
 */
export interface MeasurementSourcePort {
  /** Resolve the capability id whose `name` matches this KS name (or null). */
  resolveCapabilityId(
    tenantId: string,
    ksName: string,
  ): Promise<string | null>;
  /** The invocation + outcome window for a capability (most recent first). */
  loadWindow(
    tenantId: string,
    capabilityId: string,
  ): Promise<{
    readonly invocations: ReadonlyArray<Invocation>;
    readonly outcomes: ReadonlyArray<Outcome>;
  }>;
}

/**
 * Build a `CompetenceLookupPort` that returns the measured competence rate
 * for a KS by aggregating its capability-catalogue measurement window.
 * Returns `null` (→ shell falls back to 0.5) when no source is wired, the
 * KS maps to no capability, or the window is empty.
 */
export function createCapabilityCompetenceLookup(
  source: MeasurementSourcePort | null,
  logger: PinoLikeLogger = createPinoLikeLogger('control-shell-competence'),
): CompetenceLookupPort {
  return {
    async scoreFor(
      tenantId: string,
      ksName: string,
      _regionKind: RegionKind,
    ): Promise<number | null> {
      if (!source) return null;
      try {
        const capabilityId = await source.resolveCapabilityId(tenantId, ksName);
        if (!capabilityId) return null;
        const { invocations, outcomes } = await source.loadWindow(
          tenantId,
          capabilityId,
        );
        const measurement = aggregateMeasurement({
          tenantId,
          capabilityId,
          windowDays: 7,
          measuredAt: new Date().toISOString(),
          invocations,
          outcomes,
        });
        return measurement?.competenceRate ?? null;
      } catch (err) {
        // FAIL-SAFE: a measurement fault degrades to the shell fallback.
        logger.warn(
          { tenantId, ksName, err: errMsg(err) },
          'control-shell: competence lookup failed — degrading to fallback',
        );
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 2. KSActivityClockPort — in-memory Δt-since-last-spoke.
// ---------------------------------------------------------------------------

export interface MutableActivityClock extends KSActivityClockPort {
  /** Record that a KS just activated in a region (so a re-pick decays it). */
  noteActivation(tenantId: string, ksId: string, regionId: string): void;
}

/**
 * In-memory activation clock. Returns `null` (never spoke → fully fresh)
 * until `noteActivation` is called, after which it returns Δt in ms. The
 * runtime caches this per (tenant, ks, region) for speed; it is
 * process-local and isolates across pods.
 */
export function createInMemoryActivityClock(
  now: () => number = () => Date.now(),
): MutableActivityClock {
  const lastSpokeMs = new Map<string, number>();
  const key = (t: string, ks: string, r: string): string => `${t}::${ks}::${r}`;
  return {
    async lastSpokeAgoMs(tenantId, ksId, regionId) {
      const at = lastSpokeMs.get(key(tenantId, ksId, regionId));
      return at === undefined ? null : Math.max(0, now() - at);
    },
    noteActivation(tenantId, ksId, regionId) {
      lastSpokeMs.set(key(tenantId, ksId, regionId), now());
    },
  };
}

// ---------------------------------------------------------------------------
// 3. The delta trigger — map a converged slot → region + candidates → pickNext.
// ---------------------------------------------------------------------------

/**
 * Maps a blackboard `SlotKind` → the `RegionKind` the converged slot
 * belongs to. The slot id is the authoritative carrier (`region:subject`),
 * but the kind is a deterministic fallback so a malformed id still routes.
 */
function regionKindForSlot(slot: Slot): RegionKind {
  // Slot ids are conventionally `<region>:<subject>:<facet>` — if the head
  // is a known region kind, use it; else map by slot kind.
  const head = slot.slotId.split(':')[0] as RegionKind | undefined;
  const KNOWN: ReadonlyArray<RegionKind> = [
    'incident-investigation',
    'royalty-filing-prep',
    'buyer-deal-room',
    'shift-planning',
    'regulator-correspondence',
    'deep-research-session',
    'dashboard-composition',
  ];
  if (head && KNOWN.includes(head)) return head;
  switch (slot.slotKind) {
    case 'document':
    case 'draft':
      return 'regulator-correspondence';
    case 'dataset':
      return 'deep-research-session';
    case 'task':
      return 'shift-planning';
    case 'decision':
    case 'note':
    default:
      return 'dashboard-composition';
  }
}

/** Build a minimal Region snapshot from a converged slot. */
function regionFromSlot(slot: Slot): Region {
  return Object.freeze({
    id: slot.slotId,
    tenantId: slot.tenantId,
    scopeId: null,
    regionKind: regionKindForSlot(slot),
    status: 'active',
    openedAt: new Date(slot.wallClockMs),
    closedAt: null,
    prevHash: '',
    auditHash: '',
  });
}

/** Supplies the candidate KnowledgeSources for a region kind. */
export interface CandidateSourcePort {
  listForRegion(
    tenantId: string,
    regionKind: RegionKind,
  ): Promise<ReadonlyArray<KnowledgeSource>>;
}

// ---------------------------------------------------------------------------
// 3a. The REAL candidate source — distinct slot writers for the tenant.
//
// WHY this is the honest live source today: a `KnowledgeSource` (junior /
// connector / tool / user / external-feed) is, in the live system, an actor
// that POSTS to the blackboard. The cross-surface CRDT slot store is the only
// place that durably records WHO has contributed to a tenant's blackboard:
// each `Slot` carries the `writerId` (the Lamport actor — e.g. `brain:md`,
// `safety-junior`, `owner-web:sess-42`) of the actor that holds the register.
// The Hayes-Roth 1985 control shell asks "given who has contributed to this
// region, who should act NEXT?" — so the distinct writers that have already
// posted slots to this tenant ARE the legitimate activation candidates. We
// map each distinct writer to a KS candidate with an empty `regionFilter`
// (applies to all region kinds — the shell then scores by priority ×
// freshness × competence and picks one). Priority is derived from the writer
// id prefix via the spec's DEFAULT_KS_PRIORITY-by-kind table.
// ---------------------------------------------------------------------------

/** Classify a slot `writerId` prefix into a KnowledgeSource kind. */
function ksKindForWriter(writerId: string): KnowledgeSourceKind {
  const head = writerId.split(':')[0]?.toLowerCase() ?? '';
  // Surface/device actors and the human owner are `user`-kind authority.
  if (
    head === 'owner-web' ||
    head === 'workforce-mobile' ||
    head === 'buyer-mobile' ||
    head === 'admin-web' ||
    head === 'chat' ||
    head === 'user'
  ) {
    return 'user';
  }
  // The MD / brain and registered juniors are `junior`-kind reasoners.
  if (head === 'brain' || head === 'md' || head.endsWith('-junior')) {
    return 'junior';
  }
  if (head === 'connector') return 'connector';
  if (head === 'feed' || head === 'external-feed') return 'external-feed';
  return 'tool';
}

/** Deterministic, stable candidate id for a writer within a tenant. */
function candidateIdForWriter(tenantId: string, writerId: string): string {
  return `slot-writer:${tenantId}:${writerId}`;
}

/**
 * Build the real candidate source over the durable slot repository. Lists the
 * tenant's slots, collects the DISTINCT writer actors, and maps each to a KS
 * candidate the control shell can score. FAIL-SAFE: any repository fault
 * degrades to `[]` (no candidates → no pick) and NEVER throws — the slot path
 * is unaffected. Deterministic: candidates are sorted by id ascending so the
 * shell's tie-break is repeatable.
 */
export function createSlotWriterCandidateSource(
  repository: SlotsRepository,
  logger: PinoLikeLogger = createPinoLikeLogger('control-shell-candidates'),
): CandidateSourcePort {
  return {
    async listForRegion(
      tenantId: string,
      _regionKind: RegionKind,
    ): Promise<ReadonlyArray<KnowledgeSource>> {
      try {
        const slots = await repository.list(tenantId);
        // Distinct, live (non-tombstoned) writers — these are the actors that
        // have actually contributed to this tenant's blackboard.
        const writers = new Set<string>();
        for (const slot of slots) {
          if (slot.deleted) continue;
          if (slot.writerId) writers.add(slot.writerId);
        }
        const candidates: KnowledgeSource[] = [];
        for (const writerId of writers) {
          const ksKind = ksKindForWriter(writerId);
          candidates.push(
            Object.freeze({
              id: candidateIdForWriter(tenantId, writerId),
              tenantId,
              ksKind,
              ksName: writerId,
              // Empty filter — the writer is a candidate for every region kind;
              // the shell scores + picks one. (Per-region KS filters are a
              // future refinement once a KS↔region registry is durable.)
              regionFilter: [],
              priority: BLACKBOARD_CONSTANTS.DEFAULT_KS_PRIORITY[ksKind],
              auditHash: '',
            }),
          );
        }
        // Deterministic ordering for a repeatable control-shell tie-break.
        return candidates.sort((a, b) => a.id.localeCompare(b.id));
      } catch (err) {
        // FAIL-SAFE: a candidate-source fault degrades to no candidates.
        logger.warn(
          { tenantId, err: errMsg(err) },
          'control-shell: candidate listing failed — degrading to no candidates',
        );
        return [];
      }
    },
  };
}

/** Sink for an emitted activation — audit-plane only (never a client). */
export interface ControlActivationSink {
  onActivation(activation: ControlActivation): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// 3b. The REAL activation sink — Pino + propose-only tab_event_log audit row.
//
// AUDIT-PLANE ONLY. A `ControlActivation` is a PROPOSAL of who should act next;
// it NEVER invokes the picked KS and is NEVER returned to a client. This sink
// is the natural audit/event surface the proactive loop already uses for
// proposals (`tab_event_log`, migration 0232): we append ONE append-only row
// with a distinct `event_kind = 'control_shell_activation'` so an auditor can
// reconstruct every metalevel scheduling decision. The write is best-effort and
// RLS-bound (the row's `tenant_id` is the isolation boundary) — a missing table
// or DB fault DEGRADES to the Pino log only and never throws (the slot path and
// the turn are unaffected).
// ---------------------------------------------------------------------------

/** Minimal DB seam — just enough to run a tenant-bound execute. */
export interface ActivationSinkDbPort {
  execute(query: unknown): Promise<unknown>;
}

/**
 * Build the real audit-plane activation sink. `db` may be `null` (dev/test or
 * degraded mode) — the sink then logs via Pino only. When a db is wired it ALSO
 * appends a propose-only `tab_event_log` row under the activation's tenant RLS
 * context. Always fail-safe: never throws out of `onActivation`.
 */
export function createTabEventLogActivationSink(
  db: ActivationSinkDbPort | null,
  logger: PinoLikeLogger = createPinoLikeLogger('control-shell-sink'),
): ControlActivationSink {
  return {
    async onActivation(activation: ControlActivation): Promise<void> {
      // Pino audit line — always emitted (the canonical audit-plane record).
      logger.info(
        {
          tenantId: activation.tenantId,
          regionId: activation.regionId,
          ksId: activation.ksId,
          ksName: activation.ksName,
          score: activation.score,
          breakdown: activation.breakdown,
        },
        'control-shell: activation proposed (propose-only, audit-plane)',
      );
      if (!db) return;
      try {
        const id = `csa-${activation.tenantId}-${activation.regionId}-${activation.decidedAt.getTime()}`;
        const snapshot = {
          source: 'control-shell',
          regionId: activation.regionId,
          ksId: activation.ksId,
          ksName: activation.ksName,
          score: activation.score,
          breakdown: activation.breakdown,
          proposeOnly: true,
        };
        await withTenantContext(
          db as unknown as Parameters<typeof withTenantContext>[0],
          activation.tenantId,
          async (tx: { execute(q: unknown): Promise<unknown> }) => {
            await tx.execute(sql`
              INSERT INTO tab_event_log
                (id, tenant_id, persona_id, event_kind, actor, transport,
                 snapshot, notes)
              VALUES
                (${id}, ${activation.tenantId}, 'control-shell',
                 'control_shell_activation', 'system', 'cron',
                 ${JSON.stringify(snapshot)}::jsonb,
                 ${`Control shell proposed ${activation.ksName} for ${activation.regionId}`})
              ON CONFLICT (id) DO NOTHING
            `);
          },
        );
      } catch (err) {
        // DEGRADE-SAFE: the table may be absent or the DB unreachable — the
        // Pino audit line above is the durable record; never throw.
        logger.warn(
          { tenantId: activation.tenantId, err: errMsg(err) },
          'control-shell: tab_event_log audit write skipped (degraded)',
        );
      }
    },
  };
}

export interface ControlShellWiringDeps {
  /** Competence source (null → shell falls back to 0.5). */
  readonly measurementSource?: MeasurementSourcePort | null;
  /** Candidate KnowledgeSources per region (null → no candidates → no pick). */
  readonly candidateSource?: CandidateSourcePort | null;
  /** Audit-plane sink for emitted activations (null → log-only). */
  readonly activationSink?: ControlActivationSink | null;
  readonly logger?: PinoLikeLogger;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Test seam — inject a deterministic clock. */
  readonly activityClock?: MutableActivityClock;
  /** Test seam — inject a deterministic control shell. */
  readonly shell?: ControlShell;
}

export interface ControlShellWiring {
  readonly enabled: boolean;
  readonly shell: ControlShell;
  /** The delta handler — call when a slot converges. Never throws. */
  onSlotConverged(slot: Slot): Promise<ControlActivation | null>;
  /** Subscribe to remote SLOT_DELTA_EVENTs for a tenant. Never throws. */
  start(tenantId: string): Promise<void>;
  /** Tear down all subscriptions. Never throws. */
  stop(): Promise<void>;
}

const INERT_WIRING: ControlShellWiring = Object.freeze({
  enabled: false,
  shell: createControlShell({
    competence: { async scoreFor() { return null; } },
    activityClock: { async lastSpokeAgoMs() { return null; } },
  }),
  async onSlotConverged() {
    return null;
  },
  async start() {
    /* inert */
  },
  async stop() {
    /* inert */
  },
});

/**
 * Build the control-shell wiring. Returns an INERT wiring when the
 * kill-switch is off. The returned `onSlotConverged` is the additive delta
 * trigger; `start(tenantId)` subscribes to remote slot deltas so a
 * cross-surface convergence also schedules.
 */
export function createControlShellWiring(
  deps: ControlShellWiringDeps = {},
): ControlShellWiring {
  const env = deps.env ?? process.env;
  if (!resolveEnabled(env)) return INERT_WIRING;

  const logger = deps.logger ?? createPinoLikeLogger('control-shell');
  const minIntervalMs = resolveMinIntervalMs(env);
  const activityClock =
    deps.activityClock ?? createInMemoryActivityClock();
  const competence = createCapabilityCompetenceLookup(
    deps.measurementSource ?? null,
    logger,
  );
  const shell =
    deps.shell ?? createControlShell({ competence, activityClock });
  // Default the candidate source to the REAL slot-writer source over the
  // durable slot repository (the distinct actors that have posted to the
  // tenant's blackboard). A caller may inject a different real source; `null`
  // is NOT a default — the organ must list real candidates, not nothing. Pass
  // `candidateSource: someExplicitSource` to override.
  const candidateSource: CandidateSourcePort =
    deps.candidateSource ??
    createSlotWriterCandidateSource(getSlotsRepository(logger), logger);
  const activationSink = deps.activationSink ?? null;

  // BUDGET BOUND — coalesce a delta storm per (tenant, region).
  const lastPickMs = new Map<string, number>();
  const teardowns: Array<() => Promise<void>> = [];

  async function onSlotConverged(
    slot: Slot,
  ): Promise<ControlActivation | null> {
    try {
      const region = regionFromSlot(slot);
      const coalesceKey = `${region.tenantId}::${region.id}`;
      const nowMs = Date.now();
      const prev = lastPickMs.get(coalesceKey) ?? 0;
      if (nowMs - prev < minIntervalMs) return null;
      lastPickMs.set(coalesceKey, nowMs);

      const candidates = await candidateSource.listForRegion(
        region.tenantId,
        region.regionKind,
      );
      if (candidates.length === 0) return null;

      const activation = await shell.pickNext({ region, candidates });
      if (!activation) return null;

      // Decay the picked KS so the next delta re-weights freshness.
      activityClock.noteActivation(
        activation.tenantId,
        activation.ksId,
        activation.regionId,
      );

      // AUDIT-PLANE ONLY — log + hand to the sink; never returned to a
      // client. This is propose-only: it does NOT call the KS.
      logger.info(
        {
          tenantId: activation.tenantId,
          regionId: activation.regionId,
          ksId: activation.ksId,
          ksName: activation.ksName,
          score: activation.score,
        },
        'control-shell: pickNext activation (propose-only, audit-plane)',
      );
      if (activationSink) {
        await activationSink.onActivation(activation);
      }
      return activation;
    } catch (err) {
      // FAIL-SAFE: a control-shell fault never breaks the slot path.
      logger.warn(
        { slotId: slot.slotId, tenantId: slot.tenantId, err: errMsg(err) },
        'control-shell: pickNext-on-delta failed — slot path unaffected',
      );
      return null;
    }
  }

  // The convergence trigger is wired at the COMPOSITION ROOT via
  // `registerSlotConvergedListener(wiring.onSlotConverged)` — the slot store's
  // `onConverged` hook then fires `onSlotConverged` on every LOCAL slot write
  // (a route `set`/`remove`) without needing a realtime backend. `start` adds
  // the CROSS-REPLICA half: it `connect`s the tenant to the realtime `state-bus`
  // so a convergence that originates on ANOTHER replica/surface also merges in
  // locally (the merge fires the same `onConverged` → `onSlotConverged`). Both
  // halves funnel through one handler; `start` is purely additive and idle-safe.
  async function start(tenantId: string): Promise<void> {
    try {
      const store = getSlotStore();
      const teardown = await store.connect(tenantId);
      teardowns.push(teardown);
    } catch (err) {
      logger.warn(
        { tenantId, err: errMsg(err) },
        'control-shell: connect failed — delta scheduler idle for tenant',
      );
    }
  }

  async function stop(): Promise<void> {
    for (const teardown of teardowns.splice(0)) {
      try {
        await teardown();
      } catch {
        /* best-effort */
      }
    }
  }

  return Object.freeze({
    enabled: true,
    shell,
    onSlotConverged,
    start,
    stop,
  });
}

// ---------------------------------------------------------------------------
// 4. Leader-gated cross-replica connect supervisor.
//
// The LOCAL convergence path (registerSlotConvergedListener → onSlotConverged)
// makes the scheduler functional on EVERY replica with no leader needed — it
// is process-local, propose-only, and idempotent. This supervisor adds the
// CROSS-REPLICA half: the elected leader `connect`s each active tenant to the
// realtime `state-bus` so a convergence that originates on ANOTHER replica also
// merges locally and fires the same handler. It exposes the `start(): void` /
// `stop(): void` shape `withClusterLeader(...)` wraps, mirroring every other
// gateway supervisor. INERT (no-op) when the wiring is disabled or no tenant
// source is wired; a discovery/connect fault never throws out of a tick.
// ---------------------------------------------------------------------------

/** Discovers the tenant ids whose state-bus the leader should connect to. */
export interface ActiveTenantSource {
  listActiveTenantIds(): Promise<ReadonlyArray<string>>;
}

/**
 * Build an `ActiveTenantSource` over a Drizzle-shaped db. Returns the ids of
 * tenants whose status is `active`. DEGRADE-SAFE: any DB fault (or a null db)
 * resolves to `[]` so the connect supervisor simply idles. The leader-only
 * connect path is an enhancement over the always-on local convergence path.
 */
export function createActiveTenantSource(
  db: ActivationSinkDbPort | null,
): ActiveTenantSource {
  return {
    async listActiveTenantIds(): Promise<ReadonlyArray<string>> {
      if (!db) return [];
      try {
        const result = await db.execute(
          sql`SELECT id FROM tenants WHERE status = 'active'`,
        );
        const rows =
          (result as { rows?: ReadonlyArray<Record<string, unknown>> })?.rows ??
          (Array.isArray(result)
            ? (result as ReadonlyArray<Record<string, unknown>>)
            : []);
        return rows
          .map((r) => (typeof r.id === 'string' ? r.id : String(r.id ?? '')))
          .filter((s) => s.length > 0);
      } catch {
        return [];
      }
    },
  };
}

export interface ControlShellConnectSupervisor {
  start(): void;
  stop(): void;
}

const DEFAULT_CONNECT_REFRESH_MS = 5 * 60 * 1000; // re-scan for new tenants

/**
 * Build the leader-gated connect supervisor. On `start()` it immediately scans
 * active tenants and connects each, then re-scans on an interval so a tenant
 * created after boot is picked up. `stop()` tears down every subscription.
 * Idempotent per tenant — a tenant already connected is skipped.
 */
export function createControlShellConnectSupervisor(deps: {
  readonly wiring: ControlShellWiring;
  readonly tenantSource: ActiveTenantSource | null;
  readonly logger?: PinoLikeLogger;
  readonly refreshMs?: number;
}): ControlShellConnectSupervisor {
  const logger = deps.logger ?? createPinoLikeLogger('control-shell-connect');
  const refreshMs = deps.refreshMs ?? DEFAULT_CONNECT_REFRESH_MS;
  const connected = new Set<string>();
  let handle: ReturnType<typeof setInterval> | null = null;
  let inflight = false;

  async function scanAndConnect(): Promise<void> {
    if (!deps.wiring.enabled || !deps.tenantSource || inflight) return;
    inflight = true;
    try {
      const tenantIds = await deps.tenantSource.listActiveTenantIds();
      for (const tenantId of tenantIds) {
        if (connected.has(tenantId)) continue;
        connected.add(tenantId);
        await deps.wiring.start(tenantId); // never throws (fail-safe inside)
      }
    } catch (err) {
      logger.warn(
        { err: errMsg(err) },
        'control-shell: tenant scan failed — connect tick skipped',
      );
    } finally {
      inflight = false;
    }
  }

  return {
    start(): void {
      if (!deps.wiring.enabled || !deps.tenantSource) {
        logger.info(
          {},
          'control-shell: connect supervisor inert (disabled or no tenant source) — local convergence path still active',
        );
        return;
      }
      if (handle) return;
      void scanAndConnect();
      handle = setInterval(() => void scanAndConnect(), refreshMs);
      if (typeof handle.unref === 'function') handle.unref();
    },
    stop(): void {
      if (handle) {
        clearInterval(handle);
        handle = null;
      }
      connected.clear();
      void deps.wiring.stop();
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
