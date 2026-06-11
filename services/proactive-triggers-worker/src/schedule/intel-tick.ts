/**
 * Proactive-intel tick adapter — wires `@borjie/proactive-intel` INTO
 * the worker.
 *
 * `@borjie/proactive-intel` ships a real, complete `runTick(ctx,
 * cadence, store)` plus three live anomaly detectors (cashflow-dip,
 * royalty-arrears-spike, churn-risk), a recommendation composer, and a
 * fatigue ratchet. It is NOT dead surface — `@borjie/market-intelligence`
 * declares it as a peer dependency and references its composer. So
 * rather than delete it, this adapter folds its tick into the worker's
 * scheduled cadence.
 *
 * Why an adapter (not a direct fold into the hourly sweep): the sweep
 * is per-(tenant, user) and works off the profile/signal/trigger
 * pipeline. proactive-intel's `runTick` is per-(tenant, cadence) and
 * works off ALREADY-FETCHED financial/forecast inputs (cashflow slices,
 * royalty-arrears series, vendor histories). The worker cannot fabricate
 * those inputs, so the host supplies a `TickContext` provider; when it
 * does, this adapter runs the tick and feeds the resulting
 * recommendations to the worker's existing notification sink. When the
 * host supplies no provider, the adapter is a clean no-op — the worker
 * keeps running its sweep + follow-up cron unaffected.
 *
 * Design constraints honoured:
 *   - Wire-agnostic: the `TickContext` provider + entity-store + the
 *     recommendation publisher are all injected by the host.
 *   - Reuses the worker's notification path: recommendations are
 *     published through the injected `RecommendationPublisher` the host
 *     binds to the same delivery plumbing as fired triggers.
 *   - Immutable / Pino-only / never-throws — same discipline as the
 *     hourly sweep.
 */
import {
  ALL_CADENCES,
  runTick,
  type EntityStore,
  type Recommendation,
  type TickContext,
  type TickRunResult,
} from '@borjie/proactive-intel';
import { iterateTenants } from './tenant-iteration.js';
import {
  runDiscoveryTrigger,
  type DiscoveryTriggerWiring,
} from '../discovery/discovery-trigger.js';
import type { TenantDirectory, WorkerLogger } from '../types.js';

/** Cadence tier the (heavy, opt-in) scientific-discovery round rides. */
const DISCOVERY_CADENCE_TIER = 'cold';

/**
 * Host-supplied source of pre-fetched tick inputs. The host fans out
 * the (cheap, already-materialised) financial/forecast reads per tenant
 * + cadence and returns a ready {@link TickContext}. Returning `null`
 * means "nothing to evaluate for this (tenant, cadence)" — skipped.
 */
export interface TickContextProvider {
  build(
    tenantId: string,
    cadenceTier: string,
  ): Promise<TickContext | null> | TickContext | null;
}

/**
 * Host-supplied recommendation publisher — turns a composed
 * recommendation into a user-facing notification through the worker's
 * existing delivery plumbing. Kept as a port so this adapter never
 * couples to a concrete channel.
 */
export interface RecommendationPublisher {
  publish(
    tenantId: string,
    recommendation: Recommendation,
  ): Promise<void> | void;
}

/**
 * Host-supplied composer hook — proactive-intel's `compose` turns a
 * detector event into a `Recommendation`. The host binds it (with its
 * action-copy + fatigue policy) so this adapter stays a pure
 * orchestrator. Returning `null` drops the event (e.g. fatigue ratchet).
 */
export interface RecommendationComposer {
  compose(
    tenantId: string,
    tick: TickRunResult,
  ): Promise<ReadonlyArray<Recommendation>> | ReadonlyArray<Recommendation>;
}

/**
 * Wiring the host provides when it wants the proactive-intel tick to
 * run. All three pieces are required together — without inputs, an
 * entity-store, and a composer the tick has nothing to do.
 */
export interface IntelTickWiring {
  readonly provider: TickContextProvider;
  readonly store: EntityStore;
  readonly composer: RecommendationComposer;
  readonly publisher: RecommendationPublisher;
  /**
   * Optional cadence filter. When omitted, every declared cadence tier
   * runs. The host narrows this per scheduled invocation (e.g. only the
   * HOT cadence on the short loop).
   */
  readonly cadenceTiers?: ReadonlyArray<string>;
  /**
   * Optional scientific-discovery wiring. When supplied AND the
   * `BORJIE_SCIENTIFIC_DISCOVERY_ENABLED` flag is on, a recurring COLD
   * anomaly seeds a Co-Scientist round whose top discovery card is
   * published through `publisher`. When omitted, the discovery trigger
   * never runs. Fail-safe-to-skip — see `runDiscoveryTrigger`.
   */
  readonly discovery?: DiscoveryTriggerWiring;
}

export interface RunIntelTickDeps {
  readonly directory: TenantDirectory;
  /** Omit to disable proactive-intel entirely (clean no-op). */
  readonly wiring?: IntelTickWiring;
  readonly logger?: WorkerLogger;
  readonly concurrency?: number;
}

export interface IntelTickSummary {
  readonly enabled: boolean;
  readonly tenantsProcessed: number;
  readonly anomaliesDetected: number;
  readonly recommendationsPublished: number;
  readonly errored: number;
}

/**
 * Run one proactive-intel tick pass over every active tenant. Never
 * throws. When no wiring is supplied this is a clean no-op.
 */
export async function runIntelTick(
  deps: RunIntelTickDeps,
): Promise<IntelTickSummary> {
  const wiring = deps.wiring;
  if (!wiring) {
    deps.logger?.info?.(
      {},
      'proactive-triggers-worker: proactive-intel tick disabled (no wiring)',
    );
    return {
      enabled: false,
      tenantsProcessed: 0,
      anomaliesDetected: 0,
      recommendationsPublished: 0,
      errored: 0,
    };
  }

  let tenantIds: ReadonlyArray<string>;
  try {
    tenantIds = await deps.directory.listActiveTenants();
  } catch (error) {
    deps.logger?.warn?.(
      { err: errMsg(error) },
      'proactive-triggers-worker: tenant directory failed — intel tick aborted',
    );
    return {
      enabled: true,
      tenantsProcessed: 0,
      anomaliesDetected: 0,
      recommendationsPublished: 0,
      errored: 0,
    };
  }

  const cadenceTiers =
    wiring.cadenceTiers ?? ALL_CADENCES.map((c) => c.tier);

  const perTenant = await iterateTenants<PerTenantResult>({
    tenantIds,
    ...(deps.concurrency !== undefined ? { concurrency: deps.concurrency } : {}),
    ...(deps.logger ? { logger: deps.logger } : {}),
    runForTenant: (tenantId) =>
      runForTenant({
        tenantId,
        wiring,
        cadenceTiers,
        ...(deps.logger ? { logger: deps.logger } : {}),
      }),
    onTenantError: () => ({ anomalies: 0, published: 0, errored: true }),
  });

  let anomaliesDetected = 0;
  let recommendationsPublished = 0;
  let errored = 0;
  for (const r of perTenant) {
    anomaliesDetected += r.anomalies;
    recommendationsPublished += r.published;
    if (r.errored) errored += 1;
  }

  return {
    enabled: true,
    tenantsProcessed: perTenant.length,
    anomaliesDetected,
    recommendationsPublished,
    errored,
  };
}

interface PerTenantResult {
  readonly anomalies: number;
  readonly published: number;
  readonly errored: boolean;
}

async function runForTenant(args: {
  readonly tenantId: string;
  readonly wiring: IntelTickWiring;
  readonly cadenceTiers: ReadonlyArray<string>;
  readonly logger?: WorkerLogger;
}): Promise<PerTenantResult> {
  const { tenantId, wiring, cadenceTiers, logger } = args;
  let anomalies = 0;
  let published = 0;
  let errored = false;

  for (const cadence of ALL_CADENCES) {
    if (!cadenceTiers.includes(cadence.tier)) continue;
    try {
      const ctx = await wiring.provider.build(tenantId, cadence.tier);
      if (ctx === null) continue;

      const tick = await runTick(ctx, cadence, wiring.store);
      anomalies += tick.anomalies.length;

      const recommendations = await wiring.composer.compose(tenantId, tick);
      for (const rec of recommendations) {
        await wiring.publisher.publish(tenantId, rec);
        published += 1;
      }

      // Heavy, opt-in scientific-discovery round rides the COLD cadence
      // only — never the hot/warm path. Fail-safe-to-skip; never throws.
      if (wiring.discovery && cadence.tier === DISCOVERY_CADENCE_TIER) {
        const result = await runDiscoveryTrigger({
          tenantId,
          anomalies: tick.anomalies,
          wiring: wiring.discovery,
          nowIso: new Date(tick.nowMs).toISOString(),
          ...(logger ? { logger } : {}),
        });
        published += result.published;
      }
    } catch (error) {
      errored = true;
      logger?.warn?.(
        { tenantId, cadence: cadence.tier, err: errMsg(error) },
        'proactive-triggers-worker: intel tick failed for (tenant, cadence)',
      );
    }
  }

  return { anomalies, published, errored };
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
