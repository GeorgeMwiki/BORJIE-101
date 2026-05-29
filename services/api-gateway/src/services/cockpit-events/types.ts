/**
 * Cockpit Events — wire types.
 *
 * The cockpit SSE stream multiplexes six event kinds onto a single
 * per-tenant channel. Each event is JSON-encoded as the SSE `data`
 * field and named via the SSE `event` field; the wire envelope is
 * stable so older owner-web clients keep working when we add fields.
 *
 * NEVER mutate an event after publishing — the bus may broadcast to
 * multiple subscribers and the toast renderer freezes the payload.
 */

export const COCKPIT_EVENT_KINDS = [
  'decision.recorded',
  'reminder.fired',
  'opportunity.scan_completed',
  'risk.changed',
  'workforce.shift_event',
  'compliance.deadline_approaching',
  'mwikila.acted',
  'mwikila.proposes',
] as const;

export type CockpitEventKind = (typeof COCKPIT_EVENT_KINDS)[number];

/** Discriminated-union payload for the cockpit SSE stream. */
export type CockpitEvent =
  | DecisionRecordedEvent
  | ReminderFiredEvent
  | OpportunityScanCompletedEvent
  | RiskChangedEvent
  | WorkforceShiftEvent
  | ComplianceDeadlineApproachingEvent
  | MwikilaActedEvent
  | MwikilaProposesEvent;

interface BaseEvent {
  readonly tenantId: string;
  readonly emittedAt: string;
}

export interface DecisionRecordedEvent extends BaseEvent {
  readonly kind: 'decision.recorded';
  readonly decisionId: string;
  readonly subject: string;
  readonly severity: 'low' | 'medium' | 'high' | 'sovereign';
}

export interface ReminderFiredEvent extends BaseEvent {
  readonly kind: 'reminder.fired';
  readonly reminderId: string;
  readonly title: string;
  readonly channel: 'email' | 'sms' | 'slack';
}

export interface OpportunityScanCompletedEvent extends BaseEvent {
  readonly kind: 'opportunity.scan_completed';
  readonly opportunityCount: number;
  readonly topExpectedValueTzs: number;
}

export interface RiskChangedEvent extends BaseEvent {
  readonly kind: 'risk.changed';
  readonly riskId: string;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly previousSeverity: 'low' | 'medium' | 'high' | 'critical' | null;
}

export interface WorkforceShiftEvent extends BaseEvent {
  readonly kind: 'workforce.shift_event';
  readonly workerId: string;
  readonly transition: 'shift_start' | 'shift_end';
}

export interface ComplianceDeadlineApproachingEvent extends BaseEvent {
  readonly kind: 'compliance.deadline_approaching';
  readonly filingId: string;
  readonly filingKind: string;
  readonly dueAt: string;
  readonly daysRemaining: number;
}

/**
 * Mr. Mwikila acted on the owner's behalf — T2 or T3 execution. The
 * owner cockpit "Acting on your behalf" inbox renders this with a live
 * pulse + reversal countdown when the tier was T2.
 */
export interface MwikilaActedEvent extends BaseEvent {
  readonly kind: 'mwikila.acted';
  readonly actionId: string;
  readonly actionKind: string;
  readonly category: string;
  readonly delegationTier: 'T0' | 'T1' | 'T2' | 'T3';
  readonly summary: string;
}

/**
 * Mr. Mwikila has drafted a proposal awaiting owner approval. Sent on
 * T0/T1 proposals + on `blocked_by_inviolable` rows so the owner sees
 * the rail-block too.
 */
export interface MwikilaProposesEvent extends BaseEvent {
  readonly kind: 'mwikila.proposes';
  readonly actionId: string;
  readonly actionKind: string;
  readonly category: string;
  readonly delegationTier: 'T0' | 'T1' | 'T2' | 'T3';
  readonly summary: string;
}
