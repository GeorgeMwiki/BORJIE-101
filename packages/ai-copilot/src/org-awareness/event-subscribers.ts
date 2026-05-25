/**
 * Event subscribers — bridges the platform event bus to the process miner.
 *
 * Subscribes to maintenance.case.*, lease.renewal.*, arrears.case.*,
 * payment.reconciled, approval.decided, tender.bid, inspection.completed,
 * letter.generated, training.completed.
 *
 * Each event is transformed into a ProcessObservationInput and appended to
 * the store. Every subscription is tenant-safe because the event carries
 * its own tenantId (we never infer tenancy from anything else).
 */

import type { ProcessMiner } from './process-miner.js';
import type {
  ActorKind,
  ProcessKind,
  ProcessObservationInput,
  ProcessVariant,
} from './types.js';

/** Minimal shape of a domain event on the platform bus. */
export interface PlatformEventLike {
  readonly eventType: string;
  readonly tenantId: string;
  readonly timestamp?: string;
  readonly payload?: Record<string, unknown>;
}

/** Minimal bus surface the subscribers depend on. */
export interface PlatformBusLike {
  subscribe(
    eventType: string,
    handler: (event: PlatformEventLike) => Promise<void> | void,
  ): () => void;
}

const EVENT_TO_PROCESS: ReadonlyArray<{
  readonly prefix: string;
  readonly processKind: ProcessKind;
  readonly stageFromEventType: (eventType: string) => string;
}> = [
  {
    prefix: 'maintenance.case.',
    processKind: 'maintenance_case',
    stageFromEventType: (t) => t.replace('maintenance.case.', ''),
  },
  {
    prefix: 'lease.renewal.',
    processKind: 'lease_renewal',
    stageFromEventType: (t) => t.replace('lease.renewal.', ''),
  },
  {
    prefix: 'arrears.case.',
    processKind: 'arrears_case',
    stageFromEventType: (t) => t.replace('arrears.case.', ''),
  },
  {
    prefix: 'payment.reconciled',
    processKind: 'payment_reconcile',
    stageFromEventType: () => 'reconciled',
  },
  {
    prefix: 'approval.decided',
    processKind: 'approval_decision',
    stageFromEventType: () => 'decided',
  },
  {
    prefix: 'tender.bid',
    processKind: 'tender_bid',
    stageFromEventType: (t) =>
      t.includes('.') ? t.split('.').slice(1).join('.') : 'submitted',
  },
  {
    prefix: 'inspection.completed',
    processKind: 'inspection',
    stageFromEventType: () => 'completed',
  },
  {
    prefix: 'letter.generated',
    processKind: 'letter_generation',
    stageFromEventType: () => 'generated',
  },
  {
    prefix: 'training.completed',
    processKind: 'training_completion',
    stageFromEventType: () => 'completed',
  },
];

const ALL_SUBSCRIBED_TYPES: readonly string[] = [
  'maintenance.case.reported',
  'maintenance.case.triaged',
  'maintenance.case.assigned',
  'maintenance.case.in_progress',
  'maintenance.case.resolved',
  'maintenance.case.reopened',
  'lease.renewal.drafted',
  'lease.renewal.sent',
  'lease.renewal.accepted',
  'lease.renewal.declined',
  'arrears.case.opened',
  'arrears.case.notice_sent',
  'arrears.case.escalated',
  'arrears.case.closed',
  'payment.reconciled',
  'approval.decided',
  'tender.bid.submitted',
  'tender.bid.awarded',
  'inspection.completed',
  'letter.generated',
  'training.completed',
];

export interface OrgEventSubscriberDeps {
  readonly bus: PlatformBusLike;
  readonly miner: ProcessMiner;
  readonly logger?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Wire the miner to the platform event bus. Returns an unsubscribe
 * function that detaches every subscription — useful in tests.
 */
export function subscribeOrgEvents(
  deps: OrgEventSubscriberDeps,
): () => void {
  const unsubscribers: Array<() => void> = [];
  for (const eventType of ALL_SUBSCRIBED_TYPES) {
    const off = deps.bus.subscribe(eventType, async (event) => {
      try {
        const observation = buildObservation(event);
        if (!observation) return;
        await deps.miner.observe(observation);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        deps.logger?.('org-awareness observe failed', {
          eventType: event.eventType,
          tenantId: event.tenantId,
          error: message,
        });
      }
    });
    unsubscribers.push(off);
  }
  return () => {
    for (const off of unsubscribers) off();
  };
}

/** Translate a bus event into an observation input. Null for unknown types. */
export function buildObservation(
  event: PlatformEventLike,
): ProcessObservationInput | null {
  const match = EVENT_TO_PROCESS.find((m) =>
    event.eventType.startsWith(m.prefix),
  );
  if (!match) return null;
  const payload = event.payload ?? {};
  const processInstanceId =
    asString(payload.instanceId) ||
    asString(payload.caseId) ||
    asString(payload.leaseId) ||
    asString(payload.paymentId) ||
    asString(payload.approvalId) ||
    asString(payload.tenderId) ||
    asString(payload.inspectionId) ||
    asString(payload.letterId) ||
    asString(payload.assignmentId) ||
    asString(payload.id) ||
    'unknown';
  const stage = match.stageFromEventType(event.eventType);
  const variant = asVariant(payload.variant) ?? 'standard';
  const observedAt = event.timestamp
    ? new Date(event.timestamp)
    : new Date();
  return {
    tenantId: event.tenantId,
    processKind: match.processKind,
    processInstanceId,
    stage,
    previousStage: asString(payload.previousStage) || undefined,
    actorKind: asActorKind(payload.actorKind),
    actorId: asString(payload.actorId) || undefined,
    variant,
    isReopen:
      event.eventType === 'maintenance.case.reopened' ||
      Boolean(payload.isReopen),
    isStuck: Boolean(payload.isStuck),
    durationMsFromPrevious:
      typeof payload.durationMsFromPrevious === 'number'
        ? payload.durationMsFromPrevious
        : undefined,
    metadata: isRecord(payload.metadata) ? payload.metadata : {},
    observedAt,
  };
}

export function listSubscribedEventTypes(): readonly string[] {
  return ALL_SUBSCRIBED_TYPES;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asActorKind(v: unknown): ActorKind {
  const allowed: ActorKind[] = [
    'human',
    'system',
    'ai',
    'vendor',
    'tenant',
  ];
  return allowed.includes(v as ActorKind) ? (v as ActorKind) : 'system';
}

function asVariant(v: unknown): ProcessVariant | null {
  const allowed: ProcessVariant[] = [
    'standard',
    'emergency',
    'stuck_path',
    'fast_path',
  ];
  return allowed.includes(v as ProcessVariant)
    ? (v as ProcessVariant)
    : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
