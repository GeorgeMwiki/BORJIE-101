/**
 * loop-economy-wiring.ts — un-darks the LOOP-ECONOMY SUBSTRATE (the
 * brain's standing cognitive loops).
 *
 * THE GAP THIS CLOSES
 * -------------------
 * `createLoopRegistry` / `scheduleLoops` / `createForecastSurpriseLoop`
 * (packages/central-intelligence/src/kernel/loop-economy/) ship the
 * first-class declarative `LoopSpec` primitive — registry with a
 * synaptic-pruning population cap, a PURE scheduler that returns due
 * loops + decided action DESCRIPTORS, and the proof-of-concept
 * forecast-surprise builtin (active inference: attend first to what most
 * violated the forecast) — exported + unit-tested with ZERO production
 * callers. The brain's standing cognitive loops never ran. This module
 * composes the substrate over the REAL estate organs and drives it on
 * the established leader-gated cron seam:
 *
 *   REGISTER  builtins (forecast-surprise) + any brain-FORMED loops the
 *             optional hydration seam supplies (parsed with the
 *             substrate's own untrusted-spec `parseLoopSpec`; a
 *             malformed formed loop is dropped with an honest log).
 *             NOTE: no formed-loop persistence store exists in the
 *             repo today — the default hydrator is absent and the boot
 *             log says so honestly (builtins only).
 *   FOLD      per active tenant, the host folds each loop's named organ
 *             ports — `situationalSnapshot` reads the SAME durable
 *             situational-model store the EstateMind slow loop writes
 *             (buildEstateMindSnapshotReader; estate-mind-wiring.ts).
 *   SCHEDULE  the substrate's PURE `scheduleLoops` selects the firings;
 *             it never executes anything.
 *   MEMBRANE  each decided action's `actPort` is resolved through the
 *             GOVERNED resolver table. `proactive.proposeConcern` maps
 *             the descriptor to an `EstateProposal` and routes it
 *             through `createTabEventLogProposalSink` — the EXACT
 *             gated, idempotent proactive_nudge contract the owner
 *             cockpit inbox already drains. An actPort with no governed
 *             resolver is HELD with an honest log — NEVER executed.
 *   LEARN     the firing outcome scores the loop's efficacy back onto
 *             the registry (`reflexion.scoreLoopEfficacy` — an EMA over
 *             surfaced-vs-coalesced), and the retirement sweep prunes
 *             loops whose own pure `retireCondition` fires.
 *
 * HARD RAILS
 * ----------
 *   - READ + LEARN ONLY. Every organ port read is read-only; the ONLY
 *     act path is the existing gated proposal sink (propose-only, HITL
 *     downstream). This module never writes money/ledger/licence state
 *     and registers NO executor — a loop that wants to ACT must route
 *     through the governed proposal membrane, full stop.
 *   - FAIL-SAFE TICK. Every per-tenant pass, port fold, membrane
 *     resolution, and the outer tick are try/caught; a fault increments
 *     a counter and logs via the Pino-shape logger — it never crashes
 *     boot, a request, or the interval. The timer is `unref()`-ed.
 *   - HONEST DEGRADE. A loop whose organ port has no production reader
 *     is registered DORMANT with a structured log NAMING the missing
 *     dep (its own evaluate declines on the absent port) — never a fake
 *     source. A missing proposal sink HOLDS decided actions fail-closed.
 *   - KILL-SWITCH. `BORJIE_LOOP_ECONOMY=off|0|false|no` disables the
 *     loop (DEFAULT-ON, matching the un-darking precedent); also inert
 *     under NODE_ENV=test unless a test passes `enabled`.
 *   - DEDUPE BY CONSTRUCTION. The proposeConcern mapping reuses the
 *     kernel's drive-keyed proposal id (`drive:<driveId>`), so a loop
 *     firing COALESCES with the EstateMind slow loop's own nudge for
 *     the same concern instead of double-spamming the owner inbox.
 */

import {
  loopEconomy,
  type estateMind as estateMindNs,
  type situationalModel as situationalModelNs,
} from '@borjie/central-intelligence';
import type { PinoLikeLogger } from '../utils/pino-shim.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';
import {
  buildEstateMindSnapshotReader,
  createTabEventLogProposalSink,
} from './estate-mind-wiring.js';
import { sql } from 'drizzle-orm';

type LoopRegistry = loopEconomy.LoopRegistry;
type LoopSpec = loopEconomy.LoopSpec;
type LoopFiring = loopEconomy.LoopFiring;
type LoopActionDescriptor = loopEconomy.LoopActionDescriptor;
type DefineLoopSpecInput = loopEconomy.DefineLoopSpecInput;
type SituationalSnapshot = situationalModelNs.SituationalSnapshot;
type EstateProposal = estateMindNs.EstateProposal;
/** The strict canonical drive union the kernel's EstateProposal requires. */
type DriveId = EstateProposal['driveId'];

// ─────────────────────────────────────────────────────────────────────
// Tunables — clamped so a bad env can never push the cadence out of band.
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 min — the slow-loop cadence
const MIN_INTERVAL_MS = 60 * 1000; // 1-minute floor (SAFETY bound)
const MAX_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6-hour ceiling
/** Hard cap on tenants folded per tick (DB-read bound). */
const DEFAULT_MAX_TENANTS_PER_TICK = 200;
/** EMA step for the reflexion efficacy score. */
const EFFICACY_EMA_ALPHA = 0.2;
/** Evidence-chain cap when deriving evidence from the folded snapshot. */
const MAX_SNAPSHOT_EVIDENCE_IDS = 8;

/** DEFAULT-ON kill-switch (only off/0/false/no disables). */
export const LOOP_ECONOMY_KILL_SWITCH_ENV = 'BORJIE_LOOP_ECONOMY';

/** The one learn-port this host knows how to resolve (registry EMA). */
export const REFLEXION_LEARN_PORT = 'reflexion.scoreLoopEfficacy';

const URGENCIES = ['low', 'medium', 'high', 'critical'] as const;
type Urgency = (typeof URGENCIES)[number];

function clampInterval(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, ms));
}

function killSwitchOff(env: Readonly<Record<string, string | undefined>>): boolean {
  const v = (env[LOOP_ECONOMY_KILL_SWITCH_ENV] ?? '').trim().toLowerCase();
  return v === 'off' || v === '0' || v === 'false' || v === 'no';
}

function clamp01(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─────────────────────────────────────────────────────────────────────
// Ports the host binds — all READ-ONLY except the governed proposal sink.
// ─────────────────────────────────────────────────────────────────────

/** Per-tenant reader for one named organ port a loop's bindings declare. */
export type OrganPortReader = (
  tenantId: string,
  nowMs: number,
) => Promise<unknown>;

/** Structural twin of estate-mind-wiring's gated `ProposalSink`. */
export interface ProposalSinkLike {
  propose(proposal: EstateProposal): Promise<boolean>;
}

/** How one decided action resolved through the governed membrane. */
export type ActResolution =
  | { readonly kind: 'proposed' }
  | { readonly kind: 'coalesced' }
  | { readonly kind: 'held'; readonly reason: string };

/** A governed resolver for one actPort. NEVER a direct money/rail write. */
export type ActPortResolver = (input: {
  readonly firing: LoopFiring;
  readonly action: LoopActionDescriptor;
  readonly ports: Readonly<Record<string, unknown>>;
  readonly tenantId: string;
  readonly nowMs: number;
}) => Promise<ActResolution>;

// ─────────────────────────────────────────────────────────────────────
// proactive.proposeConcern — descriptor → EstateProposal (pure mapper)
// ─────────────────────────────────────────────────────────────────────

function snapshotOf(ports: Readonly<Record<string, unknown>>): SituationalSnapshot | null {
  const raw = ports[loopEconomy.SITUATIONAL_SNAPSHOT_PORT];
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;
  const candidate = raw as Partial<SituationalSnapshot>;
  if (typeof candidate.tenantId !== 'string') return null;
  if (!Array.isArray(candidate.entities)) return null;
  return raw as SituationalSnapshot;
}

/**
 * Map a fired loop's decided action to the kernel's `EstateProposal`
 * shape. PURE. Returns `null` when the descriptor lacks a tenant (the
 * membrane then holds it honestly). Mapping rules:
 *   - id reuses the kernel's drive-keyed `drive:<driveId>` (coalesces
 *     with the EstateMind slow loop's own nudge for the same concern);
 *     a driveless formed loop falls back to `loop:<loopId>`.
 *   - evidence: explicit `args.evidenceEntityIds` when the descriptor
 *     carries them; otherwise the top-activated entity ids of the
 *     snapshot the loop READ this pass (the organ reading IS the
 *     evidence chain) — never fabricated ids.
 */
export function actionToEstateProposal(input: {
  readonly firing: LoopFiring;
  readonly action: LoopActionDescriptor;
  readonly ports: Readonly<Record<string, unknown>>;
  readonly nowMs: number;
}): EstateProposal | null {
  const { firing, action, nowMs } = input;
  const args = action.args;
  const tenantId = typeof args.tenantId === 'string' ? args.tenantId : null;
  if (!tenantId) return null;

  // `DriveId` is the canonical 6-member tuple for TYPE-checking, but estate
  // drives are OPEN-BY-DATA-DESIGN at runtime: the kernel itself casts extra
  // ids (`'forecast-surprise' as DriveId`, `'estate-visibility' as DriveId` —
  // motivation/default-drives.ts) and the only switch over driveId carries a
  // default. We mirror that exactly: any non-empty drive id the fired loop
  // carries is honoured (cast), and a firing with no drive still proposes under
  // a loop-keyed dedupe id. This keeps the builtin forecast-surprise loop live
  // without widening the canonical tuple.
  const driveId: DriveId | null =
    typeof args.driveId === 'string' && args.driveId.length > 0
      ? (args.driveId as DriveId)
      : null;
  const urgencyRaw = args.urgency;
  const urgency: Urgency = URGENCIES.includes(urgencyRaw as Urgency)
    ? (urgencyRaw as Urgency)
    : 'medium';

  const explicitEvidence = Array.isArray(args.evidenceEntityIds)
    ? (args.evidenceEntityIds as ReadonlyArray<unknown>).filter(
        (v): v is string => typeof v === 'string' && v.length > 0,
      )
    : [];
  const snapshot = snapshotOf(input.ports);
  const snapshotEvidence =
    snapshot === null
      ? []
      : [...snapshot.entities]
          .sort((a, b) => b.activation - a.activation)
          .slice(0, MAX_SNAPSHOT_EVIDENCE_IDS)
          .map((e) => e.entity.entityId);
  const evidenceEntityIds =
    explicitEvidence.length > 0 ? explicitEvidence : snapshotEvidence;

  return Object.freeze({
    tenantId,
    id: driveId ? `drive:${driveId}` : `loop:${firing.loop.id}`,
    driveId: driveId ?? (firing.loop.id as DriveId),
    title: firing.loop.title,
    rationale: action.summary,
    // ABSOLUTE single-language mandate (CLAUDE.md): the kernel's own
    // toProposal stamps 'en' for locale-free system proposals; the
    // delivery seam renders per the owner's active locale downstream.
    locale: 'en' as const,
    urgency,
    breachSeverity: clamp01(args.breachSeverity),
    evidenceEntityIds: Object.freeze(evidenceEntityIds),
    proposedAtMs: nowMs,
  });
}

/**
 * Build the governed `proactive.proposeConcern` resolver over the gated
 * proposal sink (the EXACT proactive_nudge contract the cockpit inbox
 * drains; idempotent by drive-keyed proposal id). Propose-only.
 */
export function createProposeConcernResolver(
  sink: ProposalSinkLike,
): ActPortResolver {
  return async (input) => {
    const proposal = actionToEstateProposal(input);
    if (proposal === null) {
      return { kind: 'held', reason: 'descriptor lacks a tenantId' };
    }
    const surfaced = await sink.propose(proposal);
    return surfaced ? { kind: 'proposed' } : { kind: 'coalesced' };
  };
}

// ─────────────────────────────────────────────────────────────────────
// The cron
// ─────────────────────────────────────────────────────────────────────

export interface LoopEconomyDeps {
  /**
   * Named organ-port readers the tick folds per tenant. The default
   * production binding maps `situationalSnapshot` to the durable
   * estate-mind situational store. A loop whose bindings name a port
   * with NO reader here is registered DORMANT with an honest log.
   */
  readonly organPortReaders: Readonly<Record<string, OrganPortReader>>;
  /**
   * Governed actPort resolver table. Production binds
   * `proactive.proposeConcern` over the gated proposal sink. An actPort
   * absent from this table is HELD (logged, never executed).
   */
  readonly actPortResolvers: Readonly<Record<string, ActPortResolver>>;
  /** Active-tenant discovery. Null → zero tenants → free no-op ticks. */
  readonly listActiveTenantIds: (() => Promise<ReadonlyArray<string>>) | null;
  /**
   * Brain-FORMED loop hydration seam. No persistence store exists in
   * the repo today, so production passes null and the boot log records
   * `formedLoopStoreWired: false` honestly. When a store lands, this
   * supplies untrusted `DefineLoopSpecInput`s parsed via the
   * substrate's `parseLoopSpec` (malformed → dropped + logged).
   */
  readonly hydrateFormedLoops?: (() => Promise<ReadonlyArray<DefineLoopSpecInput>>) | null;
  readonly logger?: PinoLikeLogger;
  readonly intervalMs?: number;
  readonly maxTenantsPerTick?: number;
  /** Test override; default: on unless NODE_ENV=test or kill-switch off. */
  readonly enabled?: boolean;
  /** Injectable epoch-ms clock for deterministic tests. */
  readonly clock?: () => number;
  /** Env source (bootstrap-injected); defaults to process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface LoopEconomyTickResult {
  /** Tenants whose ports were folded this tick. */
  readonly tenantsScanned: number;
  /** Live loop population at tick time. */
  readonly loopsActive: number;
  /** Loop firings selected by the pure scheduler. */
  readonly firings: number;
  /** Firings whose decide returned null (fired, chose not to act). */
  readonly observeOnly: number;
  /** Actions that surfaced a NEW governed proposal. */
  readonly proposed: number;
  /** Actions that coalesced onto an already-pending proposal. */
  readonly coalesced: number;
  /** Actions HELD fail-closed (no governed resolver / bad descriptor). */
  readonly held: number;
  /** Reflexion efficacy scores applied to the registry. */
  readonly scored: number;
  /** Loops pruned by the retirement sweep. */
  readonly retired: number;
  /** Organ-port reads that faulted (loop declined this pass). */
  readonly portFaults: number;
  /** Faults caught by the fail-safe rails. */
  readonly errored: number;
}

export interface LoopEconomyHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<LoopEconomyTickResult>;
  /** The live registry (read seam for tests / introspection surfaces). */
  readonly registry: LoopRegistry;
}

const ZERO_RESULT: LoopEconomyTickResult = Object.freeze({
  tenantsScanned: 0,
  loopsActive: 0,
  firings: 0,
  observeOnly: 0,
  proposed: 0,
  coalesced: 0,
  held: 0,
  scored: 0,
  retired: 0,
  portFaults: 0,
  errored: 0,
});

interface MutableCounters {
  firings: number;
  observeOnly: number;
  proposed: number;
  coalesced: number;
  held: number;
  scored: number;
  retired: number;
  portFaults: number;
  errored: number;
}

/**
 * Build the governed loop-economy cron. Exposes the
 * `ClusterCronSupervisor`-compatible `start()` / `stop()` (so the
 * composition root wraps it in `withClusterLeader`) plus `tickOnce()`
 * for tests. The substrate stays pure: this host folds organ reads,
 * runs the pure scheduler, and routes decided actions ONLY through the
 * governed resolver table — it adds no parallel act path.
 */
export function createLoopEconomyCron(deps: LoopEconomyDeps): LoopEconomyHandle {
  const logger = deps.logger ?? createPinoLikeLogger('loop-economy');
  const env = deps.env ?? process.env;
  const clock = deps.clock ?? Date.now;
  const intervalMs = clampInterval(deps.intervalMs ?? DEFAULT_INTERVAL_MS);
  const maxTenants = Math.max(1, deps.maxTenantsPerTick ?? DEFAULT_MAX_TENANTS_PER_TICK);
  const enabled = deps.enabled ?? (env.NODE_ENV !== 'test' && !killSwitchOff(env));

  const registry = loopEconomy.createLoopRegistry();
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let formedHydrated = false;

  // REGISTER — builtins. The forecast-surprise loop's createdAtMs is
  // backdated one cadence so it is DUE from the first tick (the cron
  // interval is the cadence driver; the idempotent sink absorbs re-fires).
  const bootMs = clock();
  const builtins: ReadonlyArray<LoopSpec> = [
    loopEconomy.createForecastSurpriseLoop({
      createdAtMs: bootMs - intervalMs,
      everyMs: intervalMs,
    }),
  ];
  let builtinCount = 0;
  for (const spec of builtins) {
    const outcome = registry.register(spec);
    if (outcome.ok) {
      builtinCount += 1;
    } else {
      logger.warn(
        { loopId: spec.id, reason: outcome.reason },
        'loop-economy: builtin loop rejected by registry (population cap)',
      );
    }
  }

  // HONEST-DEGRADE — a loop whose organ bindings name a port with no
  // production reader is DORMANT (its own evaluate declines on the
  // absent port). Log it with the missing dep NAMED — never fake a source.
  function logDormantLoops(): void {
    for (const spec of registry.list()) {
      const missing = spec.organBindings.filter(
        (port) => deps.organPortReaders[port] === undefined,
      );
      if (missing.length > 0) {
        logger.warn(
          { loopId: spec.id, origin: spec.origin, missingOrganPorts: missing },
          'loop-economy: loop registered DORMANT — no production reader for its organ port(s); it will never fire until the dep is bound (honest degrade, no fake source)',
        );
      }
    }
  }
  logDormantLoops();

  // BOOT-PROOF SIGNAL — mirrors 'aop-meta-loop: meta-learning loop
  // composed': this line at composition time is the detectable proof the
  // loop-economy organ is no longer dark.
  logger.info(
    {
      wiring: 'loop-economy',
      loopsRegistered: registry.size(),
      builtinLoops: builtinCount,
      formedLoopStoreWired: Boolean(deps.hydrateFormedLoops),
      organPortsWired: Object.keys(deps.organPortReaders),
      actPortsWired: Object.keys(deps.actPortResolvers),
      tenantSourceWired: deps.listActiveTenantIds !== null,
      intervalMs,
      maxTenantsPerTick: maxTenants,
      killSwitchEnvFlag: LOOP_ECONOMY_KILL_SWITCH_ENV,
      enabled,
    },
    'loop-economy: cognitive-loop substrate composed (REGISTER → FOLD → SCHEDULE → MEMBRANE → LEARN); loops are READ+LEARN only — decided actions route through the governed proposal membrane',
  );

  /** Hydrate brain-FORMED loops once (untrusted specs, parseLoopSpec rail). */
  async function hydrateFormedOnce(): Promise<void> {
    if (formedHydrated) return;
    formedHydrated = true;
    if (!deps.hydrateFormedLoops) return;
    try {
      const inputs = await deps.hydrateFormedLoops();
      let registered = 0;
      for (const input of inputs) {
        const parsed = loopEconomy.parseLoopSpec({ ...input, origin: 'formed' });
        if (!parsed.ok) {
          logger.warn(
            { loopId: String(input.id ?? ''), issues: parsed.issues.length },
            'loop-economy: malformed FORMED loop dropped (honest degrade — a bad synthesised loop never crashes the economy)',
          );
          continue;
        }
        const outcome = registry.register(parsed.spec);
        if (outcome.ok) {
          registered += 1;
          if (outcome.evicted) {
            logger.info(
              { loopId: parsed.spec.id, evicted: outcome.evicted.id },
              'loop-economy: formed loop admitted by evicting the lowest-efficacy resident (synaptic pruning)',
            );
          }
        } else {
          logger.warn(
            { loopId: parsed.spec.id, reason: outcome.reason },
            'loop-economy: formed loop rejected by registry (population cap; newcomer did not out-score the weakest resident)',
          );
        }
      }
      if (registered > 0) {
        logger.info(
          { formedLoopsRegistered: registered, population: registry.size() },
          'loop-economy: brain-formed loops hydrated into the registry',
        );
        logDormantLoops();
      }
    } catch (err) {
      logger.warn(
        { err: errMsg(err) },
        'loop-economy: formed-loop hydration failed (builtins continue; retried next tick)',
      );
      formedHydrated = false; // retry on the next tick
    }
  }

  /** Fold the union of needed organ ports for one tenant. Fail-safe. */
  async function foldPorts(
    tenantId: string,
    nowMs: number,
    counters: MutableCounters,
  ): Promise<Readonly<Record<string, unknown>>> {
    const needed = new Set<string>();
    for (const spec of registry.listActive()) {
      for (const port of spec.organBindings) {
        if (deps.organPortReaders[port] !== undefined) needed.add(port);
      }
    }
    const entries: Array<readonly [string, unknown]> = [];
    for (const port of needed) {
      try {
        const value = await deps.organPortReaders[port]!(tenantId, nowMs);
        if (value !== null && value !== undefined) entries.push([port, value]);
      } catch (err) {
        counters.portFaults += 1;
        logger.warn(
          { tenantId, port, err: errMsg(err) },
          'loop-economy: organ port read failed — loops bound to it decline this pass (fail-safe)',
        );
      }
    }
    return Object.freeze(Object.fromEntries(entries));
  }

  /** Route one firing through the governed membrane + reflexion LEARN. */
  async function resolveFiring(
    firing: LoopFiring,
    ports: Readonly<Record<string, unknown>>,
    tenantId: string,
    nowMs: number,
    counters: MutableCounters,
  ): Promise<void> {
    counters.firings += 1;
    const action = firing.action;
    if (action === null) {
      counters.observeOnly += 1;
      return;
    }
    let resolution: ActResolution;
    const resolver = deps.actPortResolvers[action.actPort];
    if (resolver === undefined) {
      resolution = {
        kind: 'held',
        reason: `no governed resolver for actPort '${action.actPort}'`,
      };
      logger.warn(
        { loopId: firing.loop.id, tenantId, actPort: action.actPort },
        'loop-economy: decided action HELD — actPort has no governed resolver; it was NOT executed (propose-only membrane, fail-closed)',
      );
    } else {
      try {
        resolution = await resolver({ firing, action, ports, tenantId, nowMs });
      } catch (err) {
        counters.errored += 1;
        resolution = { kind: 'held', reason: errMsg(err) };
        logger.error(
          { loopId: firing.loop.id, tenantId, actPort: action.actPort, err: errMsg(err) },
          'loop-economy: governed resolver failed — action held (fail-safe, tick continues)',
        );
      }
    }
    switch (resolution.kind) {
      case 'proposed':
        counters.proposed += 1;
        logger.info(
          { loopId: firing.loop.id, tenantId, actPort: action.actPort, summary: action.summary },
          'loop-economy: loop firing surfaced a governed proposal (proactive_nudge — owner decides, never auto-acted)',
        );
        break;
      case 'coalesced':
        counters.coalesced += 1;
        break;
      case 'held':
        counters.held += 1;
        break;
    }
    // LEARN — the reflexion hook scores efficacy back onto the registry:
    // a NEW surfaced concern is full signal; re-raising an already-pending
    // one is weak signal; a held action carries no score (not the loop's
    // fault). EMA so one tick never whipsaws a proven loop.
    if (firing.loop.learnPort === REFLEXION_LEARN_PORT && resolution.kind !== 'held') {
      const score = resolution.kind === 'proposed' ? 1 : 0.5;
      const prior = registry.get(firing.loop.id)?.efficacy ?? null;
      const next = prior === null ? score : prior + EFFICACY_EMA_ALPHA * (score - prior);
      if (registry.updateEfficacy(firing.loop.id, next) !== undefined) {
        counters.scored += 1;
      }
    }
  }

  async function tickOnce(): Promise<LoopEconomyTickResult> {
    if (running) return ZERO_RESULT;
    running = true;
    const counters: MutableCounters = {
      firings: 0,
      observeOnly: 0,
      proposed: 0,
      coalesced: 0,
      held: 0,
      scored: 0,
      retired: 0,
      portFaults: 0,
      errored: 0,
    };
    let tenantsScanned = 0;
    try {
      await hydrateFormedOnce();
      const nowMs = clock();
      const tenantIds = deps.listActiveTenantIds
        ? (await deps.listActiveTenantIds()).slice(0, maxTenants)
        : [];
      for (const tenantId of tenantIds) {
        try {
          tenantsScanned += 1;
          const ports = await foldPorts(tenantId, nowMs, counters);
          const firings = loopEconomy.scheduleLoops({ registry, nowMs, ports });
          for (const firing of firings) {
            await resolveFiring(firing, ports, tenantId, nowMs, counters);
          }
        } catch (err) {
          counters.errored += 1;
          logger.error(
            { tenantId, err: errMsg(err) },
            'loop-economy: tenant pass failed (fail-safe — tick continues)',
          );
        }
      }
      // RETIREMENT sweep — the substrate's own pure retireCondition decides;
      // a throwing condition never retires (honest degrade inside the kernel).
      for (const spec of loopEconomy.loopsToRetire({ registry, nowMs })) {
        if (registry.retire(spec.id) !== undefined) {
          counters.retired += 1;
          logger.info(
            { loopId: spec.id, origin: spec.origin, efficacy: spec.efficacy },
            'loop-economy: loop retired by its own retireCondition (synaptic pruning)',
          );
        }
      }
    } catch (err) {
      // The outermost guard — a fault here NEVER escapes the tick.
      counters.errored += 1;
      logger.error(
        { err: errMsg(err) },
        'loop-economy: tick failed (fail-safe — loop keeps its cadence)',
      );
    } finally {
      running = false;
    }
    return Object.freeze({
      tenantsScanned,
      loopsActive: registry.size(),
      firings: counters.firings,
      observeOnly: counters.observeOnly,
      proposed: counters.proposed,
      coalesced: counters.coalesced,
      held: counters.held,
      scored: counters.scored,
      retired: counters.retired,
      portFaults: counters.portFaults,
      errored: counters.errored,
    });
  }

  return {
    registry,
    start(): void {
      if (!enabled) {
        logger.info(
          { intervalMs, killSwitchEnvFlag: LOOP_ECONOMY_KILL_SWITCH_ENV },
          'loop-economy: disabled (no start)',
        );
        return;
      }
      if (timer) {
        logger.warn({}, 'loop-economy: already running, ignoring duplicate start');
        return;
      }
      logger.info({ intervalMs, loops: registry.size() }, 'loop-economy: started');
      timer = setInterval(() => {
        void tickOnce();
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    tickOnce,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Production composition — binds the REAL estate organs. The single
// entry point index.ts calls (1 import + 1 construction block).
// ─────────────────────────────────────────────────────────────────────

/** Narrow structural db seam (`execute(sql)`) — test-double-able. */
interface DbExecLike {
  execute(query: unknown): Promise<unknown>;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  const rows = (result as { rows?: ReadonlyArray<Record<string, unknown>> })?.rows;
  return Array.isArray(rows) ? rows : [];
}

/** Same active-tenant discovery the EstateMind heartbeat uses. Read-only. */
async function listActiveTenantIdsFromDb(
  db: DbExecLike,
): Promise<ReadonlyArray<string>> {
  try {
    const result = await db.execute(
      sql`SELECT id FROM tenants WHERE status = 'active'`,
    );
    return rowsOf(result)
      .map((r) => (typeof r.id === 'string' ? r.id : String(r.id ?? '')))
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

export interface CreateLoopEconomyCronFromDbArgs {
  /**
   * Drizzle client (+ raw execute). Null → degraded mode: the builtin
   * loops register DORMANT (missing organ readers, honestly logged),
   * the tenant source is empty, and every tick is a free no-op.
   */
  readonly db:
    | (Parameters<typeof buildEstateMindSnapshotReader>[0] & DbExecLike)
    | null;
  readonly logger?: PinoLikeLogger;
  readonly intervalMs?: number;
  readonly enabled?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Compose the loop economy over the REAL production organs:
 *   - `situationalSnapshot` ← the durable estate-mind situational store
 *     (the SAME reader the salience arena + drive resolver use);
 *   - `proactive.proposeConcern` ← the gated tab_event_log proposal
 *     sink (the EXACT idempotent proactive_nudge contract);
 *   - tenants ← the EstateMind heartbeat's active-tenant SELECT.
 * No formed-loop persistence store exists in the repo yet, so the
 * hydration seam stays null (boot log records it honestly).
 */
export function createLoopEconomyCronFromDb(
  args: CreateLoopEconomyCronFromDbArgs,
): LoopEconomyHandle {
  const logger = args.logger ?? createPinoLikeLogger('loop-economy');
  const db = args.db;

  const organPortReaders: Readonly<Record<string, OrganPortReader>> = db
    ? Object.freeze({
        [loopEconomy.SITUATIONAL_SNAPSHOT_PORT]: (() => {
          const reader = buildEstateMindSnapshotReader(db, logger);
          return (tenantId: string) => reader.read(tenantId);
        })(),
      })
    : Object.freeze({});

  const actPortResolvers: Readonly<Record<string, ActPortResolver>> = db
    ? Object.freeze({
        [loopEconomy.FORECAST_SURPRISE_ACT_PORT]: createProposeConcernResolver(
          createTabEventLogProposalSink(db, logger),
        ),
      })
    : Object.freeze({});

  return createLoopEconomyCron({
    organPortReaders,
    actPortResolvers,
    listActiveTenantIds: db ? () => listActiveTenantIdsFromDb(db) : null,
    hydrateFormedLoops: null,
    logger,
    ...(args.intervalMs !== undefined ? { intervalMs: args.intervalMs } : {}),
    ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
    ...(args.env !== undefined ? { env: args.env } : {}),
  });
}
