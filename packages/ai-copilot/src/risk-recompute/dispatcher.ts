/**
 * Risk recompute dispatcher — Wave 27 (Part B.6 amplification).
 *
 * Subscribes to the platform event bus and fans-out every event to the
 * relevant risk compute functions. The dispatcher itself is purely a
 * fan-out / de-duplication / telemetry surface — the actual scoring
 * logic lives in CreditRatingService / PropertyGradingService / etc.
 *
 * Idempotency: jobs are deduped within a short window keyed on
 * `(kind, entityId, triggerEventId)` to protect against redelivered
 * events from the outbox.
 *
 * Fail-soft: a throwing compute function is captured in telemetry but
 * never bubbles up to the publisher.
 *
 * Example wiring:
 *
 *   const dispatcher = createRiskRecomputeDispatcher({
 *     registry: {
 *       credit_rating: (job) => creditRating.computeRating(job.tenantId, job.entityId),
 *       property_grade: (job) => propertyGrading.gradeProperty(job.tenantId, job.entityId),
 *       vendor_scorecard: (job) => vendorScoring.recompute(job.tenantId, job.entityId),
 *       churn_probability: (job) => churnModel.predictFor(job.tenantId, job.entityId),
 *       tenant_sentiment: (job) => sentimentScorer.recompute(job.tenantId, job.entityId),
 *     },
 *     classifier: defaultRiskEventClassifier,
 *     telemetry: (t) => observer.log('risk_recompute', t),
 *   });
 *   dispatcher.subscribeTo(eventBus);
 */

import { defaultRiskEventClassifier } from './default-classifier.js';
import type {
  RiskComputeFn,
  RiskComputeJob,
  RiskComputeRegistry,
  RiskDispatchResult,
  RiskDispatcherTelemetry,
  RiskEventClassifier,
  RiskKind,
  RiskTriggerMatch,
} from './types.js';

/**
 * A minimal subscription contract so this module can plug into either
 * the domain `EventBus` in `services/domain-services/src/common/events.ts`
 * or the observability bus. We only require `.subscribe(type, handler)`.
 */
export interface SubscribableEventBus {
  subscribe(
    eventType: string,
    handler: (envelope: {
      event: {
        eventType: string;
        eventId: string;
        tenantId: string;
        timestamp: string;
      } & Record<string, unknown>;
    }) => Promise<void>,
  ): () => void;
}

export interface RiskRecomputeDispatcherDeps {
  readonly registry: RiskComputeRegistry;
  readonly classifier?: RiskEventClassifier;
  readonly telemetry?: (t: RiskDispatcherTelemetry) => void;
  readonly now?: () => Date;
  /** Deduplication window in ms. Default: 5s. */
  readonly dedupeWindowMs?: number;
  /**
   * Event types the dispatcher subscribes to. Defaults to the list
   * handled by `defaultRiskEventClassifier`.
   */
  readonly eventTypes?: readonly string[];
}

export const DEFAULT_DEDUPE_WINDOW_MS = 5_000;

export const DEFAULT_SUBSCRIBED_EVENT_TYPES: readonly string[] = [
  'PaymentReceived',
  'PaymentMissed',
  'LeaseSigned',
  'LeaseTerminated',
  'ArrearsCaseOpened',
  'ArrearsCaseClosed',
  'InspectionCompleted',
  'PropertyInspectionSurveyAdded',
  'WorkOrderClosed',
  'WorkOrderResolved',
  'MessageReceived',
  'TenantChatMessage',
  'RenewalConversationUpdated',
  'MaintenancePhotoUploaded',
];

export interface RiskRecomputeDispatcher {
  /**
   * Directly dispatch an event (used by tests; production wires into
   * `subscribeTo` to pull from the bus).
   */
  dispatchEvent(input: {
    readonly eventType: string;
    readonly eventId: string;
    readonly tenantId: string;
    readonly payload: Record<string, unknown>;
  }): Promise<RiskDispatchResult>;
  /** Register the dispatcher as a subscriber on the supplied bus. */
  subscribeTo(bus: SubscribableEventBus): () => void;
  /** Inspect: how many compute functions are registered. */
  readonly registeredKinds: readonly RiskKind[];
}

export function createRiskRecomputeDispatcher(
  deps: RiskRecomputeDispatcherDeps,
): RiskRecomputeDispatcher {
  const classifier = deps.classifier ?? defaultRiskEventClassifier;
  const now = deps.now ?? (() => new Date());
  const dedupeWindowMs = deps.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  const subscribedEventTypes = deps.eventTypes ?? DEFAULT_SUBSCRIBED_EVENT_TYPES;

  // dedupe store: jobKey → enqueuedAtMs
  const recentJobs = new Map<string, number>();

  function pruneDedupe(nowMs: number): void {
    for (const [key, ts] of recentJobs) {
      if (nowMs - ts > dedupeWindowMs) recentJobs.delete(key);
    }
  }

  function jobKey(match: RiskTriggerMatch, eventId: string): string {
    return `${match.kind}|${match.entityId}|${eventId}`;
  }

  async function run(
    computeFn: RiskComputeFn,
    job: RiskComputeJob,
  ): Promise<RiskDispatcherTelemetry> {
    const startedAt = now();
    const startedMs = startedAt.getTime();
    try {
      await computeFn(job);
      const durationMs = now().getTime() - startedMs;
      return {
        tickAt: startedAt.toISOString(),
        kind: job.kind,
        entityId: job.entityId,
        triggerEventId: job.triggerEventId,
        triggerEventType: job.triggerEventType,
        outcome: 'ok',
        durationMs,
      };
    } catch (error) {
      const durationMs = now().getTime() - startedMs;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        tickAt: startedAt.toISOString(),
        kind: job.kind,
        entityId: job.entityId,
        triggerEventId: job.triggerEventId,
        triggerEventType: job.triggerEventType,
        outcome: 'error',
        durationMs,
        errorMessage,
      };
    }
  }

  async function dispatchEvent(input: {
    readonly eventType: string;
    readonly eventId: string;
    readonly tenantId: string;
    readonly payload: Record<string, unknown>;
  }): Promise<RiskDispatchResult> {
    const tickMs = now().getTime();
    pruneDedupe(tickMs);

    const matches = classifier(input.eventType, input.payload);
    const failures: Array<{
      kind: RiskKind;
      entityId: string;
      reason: string;
    }> = [];
    let dispatched = 0;

    for (const match of matches) {
      const computeFn = deps.registry[match.kind];
      if (!computeFn) {
        // Kind not wired for this tenant deployment — skip silently.
        continue;
      }
      const key = jobKey(match, input.eventId);
      if (recentJobs.has(key)) continue;
      recentJobs.set(key, tickMs);

      const job: RiskComputeJob = {
        tenantId: input.tenantId,
        kind: match.kind,
        entityId: match.entityId,
        triggerEventId: input.eventId,
        triggerEventType: input.eventType,
        enqueuedAt: new Date(tickMs).toISOString(),
      };
      const telemetry = await run(computeFn, job);
      if (telemetry.outcome === 'error') {
        failures.push({
          kind: match.kind,
          entityId: match.entityId,
          reason: telemetry.errorMessage ?? 'unknown',
        });
      } else {
        dispatched += 1;
      }
      deps.telemetry?.(telemetry);
    }

    return {
      jobsDispatched: dispatched,
      failures,
    };
  }

  function subscribeTo(bus: SubscribableEventBus): () => void {
    const unsubs: Array<() => void> = [];
    for (const type of subscribedEventTypes) {
      const unsub = bus.subscribe(type, async (envelope) => {
        const ev = envelope.event;
        // The event bus envelopes carry the payload as a shape-specific
        // `payload` property on most domain events. Fall back to the
        // whole event for flexibility.
        const payload =
          ((ev as { payload?: unknown }).payload as
            | Record<string, unknown>
            | undefined) ?? (ev as unknown as Record<string, unknown>);
        await dispatchEvent({
          eventType: ev.eventType,
          eventId: ev.eventId,
          tenantId: ev.tenantId,
          payload,
        });
      });
      unsubs.push(unsub);
    }
    return () => {
      for (const u of unsubs) u();
    };
  }

  const registeredKinds = Object.keys(deps.registry) as RiskKind[];

  return {
    dispatchEvent,
    subscribeTo,
    registeredKinds,
  };
}
