/**
 * Brain-tick runner.
 *
 * Pure orchestrator: given a TickContext + cadence spec, run the
 * declared detectors, persist their events to the entity-store, and
 * return them for the composer to chew on.
 *
 * Deliberately short. No cron, no queue, no retry — those belong to
 * the outer scheduler (BullMQ in the orchestrator app). This function
 * is `(ctx, cadence) => events[]`.
 *
 * Pipeline: dispatch → collect → write → return.
 */
import type {
  AnomalyEvent,
  OpportunityEvent,
  DetectorEvent,
} from '../contracts/events.js';
import type { EntityStore } from '../contracts/entity-store.js';
import {
  ANOMALY_DETECTORS,
  OPPORTUNITY_DETECTORS,
} from './detector-registry.js';
import type { CadenceSpec } from './tick-cadences.js';
import type { TickContext } from './tick-context.js';

export interface TickRunResult {
  readonly anomalies: ReadonlyArray<AnomalyEvent>;
  readonly opportunities: ReadonlyArray<OpportunityEvent>;
  readonly persisted: number;
  readonly tier: string;
  readonly tenantId: string | null;
  readonly nowMs: number;
}

export async function runTick(
  ctx: TickContext,
  cadence: CadenceSpec,
  store: EntityStore,
): Promise<TickRunResult> {
  const anomalies = collectAnomalies(ctx, cadence);
  const opportunities = collectOpportunities(ctx, cadence);
  const persisted = await persist(store, ctx, [
    ...anomalies,
    ...opportunities,
  ]);
  return {
    anomalies,
    opportunities,
    persisted,
    tier: cadence.tier,
    tenantId: ctx.tenantId,
    nowMs: ctx.nowMs,
  };
}

function collectAnomalies(
  ctx: TickContext,
  cadence: CadenceSpec,
): ReadonlyArray<AnomalyEvent> {
  const out: AnomalyEvent[] = [];
  for (const kind of cadence.anomalyKinds) {
    const fn = ANOMALY_DETECTORS[kind];
    if (!fn) continue;
    for (const ev of fn(ctx)) out.push(ev);
  }
  return out;
}

function collectOpportunities(
  ctx: TickContext,
  cadence: CadenceSpec,
): ReadonlyArray<OpportunityEvent> {
  const out: OpportunityEvent[] = [];
  for (const kind of cadence.opportunityKinds) {
    const fn = OPPORTUNITY_DETECTORS[kind];
    if (!fn) continue;
    for (const ev of fn(ctx)) out.push(ev);
  }
  return out;
}

async function persist(
  store: EntityStore,
  ctx: TickContext,
  events: ReadonlyArray<DetectorEvent>,
): Promise<number> {
  let count = 0;
  for (const ev of events) {
    await store.write({
      scope: ctx.scope,
      tenantId: ctx.tenantId,
      kind: `proactive-intel.${ev.type}.${ev.kind}`,
      id: ev.id,
      data: ev,
    });
    count += 1;
  }
  return count;
}
