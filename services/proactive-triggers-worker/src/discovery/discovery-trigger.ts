/**
 * Discovery trigger — wires `@borjie/scientific-discovery` INTO the
 * proactive-triggers worker's intel tick.
 *
 * Fire point: the intel tick already iterates (tenant, cadence) and owns
 * a recommendation publisher. On the COLD cadence, when a *recurring*
 * anomaly fires whose kind maps onto a `DiscoveryArea`, this module seeds
 * a Co-Scientist round: `runDiscovery({ seeds: seedsByArea(area), … })`,
 * builds a `DiscoveryCard` from the top-ranked hypothesis, and publishes
 * it through the SAME `RecommendationPublisher` sink as a fired trigger.
 *
 * Design discipline (matches the rest of the worker):
 *   - Default-OFF env flag `BORJIE_SCIENTIFIC_DISCOVERY_ENABLED` (mirrors
 *     BORJIE_CAUSAL_INFERENCE_ENABLED). When unset/false this is a no-op.
 *   - Fail-safe to SKIP: if `DISCOVERY_SIDECAR_URL` is unset, or the
 *     sidecar `health()` rejects, log via the injected logger and return
 *     without publishing. NEVER throws, NEVER stalls the tick.
 *   - Heavy work rides COLD only — the caller gates the cadence so the
 *     expensive Co-Scientist loop never blocks hot anomaly detection.
 *   - Immutable; logger-only (Pino in prod), no console.*.
 *
 * The LLM and sidecar are injected (ports) so the worker never imports a
 * provider here — the composition root binds the ai-copilot multi-llm
 * synthesizer + `createSidecarClient`.
 */
import type { AnomalyEvent } from '@borjie/proactive-intel';
import {
  buildDiscoveryCard,
  runDiscovery,
  seedsByArea,
  type DiscoveryArea,
  type LLMClient,
  type SidecarClient,
} from '@borjie/scientific-discovery';
import type { WorkerLogger } from '../types.js';
import type { RecommendationPublisher } from '../schedule/intel-tick.js';
import { mapAnomalyKindToDiscoveryArea } from './area-map.js';
import { cardToRecommendation } from './card-to-recommendation.js';

export const DISCOVERY_ENABLED_ENV = 'BORJIE_SCIENTIFIC_DISCOVERY_ENABLED';

/**
 * Decides whether an anomaly is RECURRING/persistent (not one-shot) for
 * the tenant. The worker binds this to a durable store (e.g. counting
 * prior occurrences of the same (tenantId, kind) in the entity-store).
 * Injected so this module stays pure-ish and unit-testable.
 */
export interface RecurrenceOracle {
  isRecurring(tenantId: string, anomaly: AnomalyEvent): Promise<boolean> | boolean;
}

/**
 * Builds the per-(tenant, run) data-lake pointer the sidecar resolves for
 * refutation. CRITICAL (SEC-2): the host resolves ONLY the calling
 * tenant's data, RLS-bound, BEFORE handing back the pointer. A `null`
 * return means "no data available" → the round is skipped.
 */
export interface DataRefProvider {
  build(tenantId: string, area: DiscoveryArea): Promise<string | null> | string | null;
}

export interface DiscoveryTriggerWiring {
  readonly llm: LLMClient;
  /**
   * Concrete sidecar client, or a factory that may throw/return null when
   * `DISCOVERY_SIDECAR_URL` is unset. Threaded through so the trigger can
   * fail-safe to SKIP when the sidecar is unreachable.
   */
  readonly sidecar: SidecarClient | null;
  readonly recurrence: RecurrenceOracle;
  readonly dataRef: DataRefProvider;
  readonly publisher: RecommendationPublisher;
}

export interface RunDiscoveryTriggerArgs {
  readonly tenantId: string;
  /** Anomalies detected this COLD tick for the tenant. */
  readonly anomalies: ReadonlyArray<AnomalyEvent>;
  readonly wiring: DiscoveryTriggerWiring;
  /** ISO timestamp for determinism in tests. */
  readonly nowIso: string;
  readonly logger?: WorkerLogger;
}

export interface DiscoveryTriggerResult {
  readonly ran: boolean;
  readonly published: number;
  /** Why the trigger did not run (for observability). */
  readonly skippedReason:
    | 'disabled'
    | 'no-recurring-area'
    | 'sidecar-unavailable'
    | 'no-data-ref'
    | 'empty-run'
    | null;
}

/**
 * Whether the discovery trigger is enabled. Default OFF — only `true`/`1`
 * turns it on. Read once per call by the caller's convention; kept here so
 * the gate lives next to the trigger it guards.
 */
export function isDiscoveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[DISCOVERY_ENABLED_ENV];
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

const DISABLED: DiscoveryTriggerResult = {
  ran: false,
  published: 0,
  skippedReason: 'disabled',
};

/**
 * Run the discovery trigger for one tenant's COLD tick. Never throws.
 *
 * Returns a {@link DiscoveryTriggerResult} describing what happened so the
 * caller can roll up counts. The function is the single side-effecting
 * surface: LLM + sidecar calls + the publish, all via injected ports.
 */
export async function runDiscoveryTrigger(
  args: RunDiscoveryTriggerArgs,
): Promise<DiscoveryTriggerResult> {
  const { tenantId, anomalies, wiring, nowIso, logger } = args;

  if (!isDiscoveryEnabled()) {
    return DISABLED;
  }

  // Fail-safe: no sidecar (URL unset / construction failed) → SKIP.
  if (wiring.sidecar === null) {
    logger?.info?.(
      { tenantId },
      'discovery-trigger: sidecar unavailable (DISCOVERY_SIDECAR_URL unset) — skipping',
    );
    return { ran: false, published: 0, skippedReason: 'sidecar-unavailable' };
  }

  try {
    // 1. Find a recurring anomaly whose kind maps onto a discovery area.
    const target = await selectRecurringArea(tenantId, anomalies, wiring.recurrence);
    if (!target) {
      return { ran: false, published: 0, skippedReason: 'no-recurring-area' };
    }

    // 2. Probe the sidecar — fail-safe to SKIP if it is down.
    const healthy = await probeSidecar(wiring.sidecar, tenantId, logger);
    if (!healthy) {
      return { ran: false, published: 0, skippedReason: 'sidecar-unavailable' };
    }

    // 3. Resolve the tenant-scoped, RLS-bound data pointer (SEC-2).
    const dataRef = await wiring.dataRef.build(tenantId, target.area);
    if (!dataRef) {
      return { ran: false, published: 0, skippedReason: 'no-data-ref' };
    }

    // 4. Seed + run the Co-Scientist round on the COLD cadence.
    const seeds = seedsByArea(target.area);
    const run = await runDiscovery({
      runId: `disc-${tenantId}-${target.area}-${nowIso}`,
      seeds,
      llm: wiring.llm,
      sidecar: wiring.sidecar,
      anomalyArea: target.area,
      dataRef,
      now: nowIso,
    });

    const top = run.ranked[0];
    if (!top) {
      return { ran: true, published: 0, skippedReason: 'empty-run' };
    }

    // 5. Build a DiscoveryCard from the top-ranked hypothesis.
    const fusion = run.causalFusion.find(
      (f) => f.dag.nodes.includes(top.hypothesis.treatment),
    );
    const reflection = run.reflections.find(
      (r) => r.hypothesisId === top.hypothesis.id,
    );
    const card = buildDiscoveryCard({
      ranked: top,
      causalFusion: fusion,
      reflection,
      now: nowIso,
      cardId: `${run.runId}-${top.hypothesis.id}`,
    });

    // 6. Publish through the existing recommendation sink.
    const recommendation = cardToRecommendation({
      tenantId,
      card,
      sourceKind: target.anomaly.kind,
      sourceEventId: target.anomaly.id,
      nowIso,
    });
    await wiring.publisher.publish(tenantId, recommendation);

    logger?.info?.(
      { tenantId, area: target.area, cardId: card.id },
      'discovery-trigger: published discovery card',
    );
    return { ran: true, published: 1, skippedReason: null };
  } catch (error) {
    // Fail-safe: a failing discovery round NEVER sinks the tick.
    logger?.warn?.(
      { tenantId, err: errMsg(error) },
      'discovery-trigger: run failed — skipped (tick continues)',
    );
    return { ran: false, published: 0, skippedReason: 'sidecar-unavailable' };
  }
}

interface RecurringTarget {
  readonly area: DiscoveryArea;
  readonly anomaly: AnomalyEvent;
}

async function selectRecurringArea(
  tenantId: string,
  anomalies: ReadonlyArray<AnomalyEvent>,
  recurrence: RecurrenceOracle,
): Promise<RecurringTarget | null> {
  for (const anomaly of anomalies) {
    const area = mapAnomalyKindToDiscoveryArea(anomaly.kind);
    if (!area) continue;
    const recurring = await recurrence.isRecurring(tenantId, anomaly);
    if (recurring) {
      return { area, anomaly };
    }
  }
  return null;
}

async function probeSidecar(
  sidecar: SidecarClient,
  tenantId: string,
  logger: WorkerLogger | undefined,
): Promise<boolean> {
  try {
    const health = await sidecar.health();
    if (!health.ok) {
      logger?.info?.(
        { tenantId, version: health.version },
        'discovery-trigger: sidecar reported not-ok health — skipping',
      );
      return false;
    }
    return true;
  } catch (error) {
    logger?.info?.(
      { tenantId, err: errMsg(error) },
      'discovery-trigger: sidecar health() rejected — skipping',
    );
    return false;
  }
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
