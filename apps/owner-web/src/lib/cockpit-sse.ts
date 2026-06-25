'use client';

import { useEffect, useState } from 'react';

import { API_BASE } from './api-client';
import { tailStrings as S } from '@/i18n/strings/tail';
import { cockpitSseEventsStrings as E } from '@/i18n/strings/cockpit-sse-events';

/** Fill `{token}` placeholders in a tailStrings template. */
function fill(
  template: string,
  vars: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name)
      ? String(vars[name])
      : match,
  );
}

/**
 * Cockpit live SSE hook (Roadmap R6).
 *
 * Opens an EventSource against `/api/v1/cockpit/stream` and emits a
 * typed CockpitEvent for every push the gateway delivers. The gateway
 * broadcasts EVERY event published on the tenant channel to the owner
 * stream (cockpit-stream.hono.ts does not filter by kind), so this hook's
 * `COCKPIT_EVENT_KINDS` allowlist must be a SUPERSET of the owner-targeted
 * emitted set in `services/api-gateway/src/services/cockpit-events/types.ts`
 * — any kind missing here is a live pulse the owner silently drops. The
 * `cockpit-sse.test.ts` contract test enforces the superset relationship.
 *
 * Kinds span the original R6 six (decision / reminder / opportunity / risk /
 * workforce-shift / compliance-deadline), the L6 production posting, the
 * cross-actor pulses (safety / bids / payroll / Mr. Mwikila / regulator /
 * task / settlement / licence-renewal), and the CT-5 dynamic-tab CRUD bus.
 *
 * The hook is fully cancellable: unmounting closes the EventSource and
 * the heartbeat ticker is recycled by the browser GC.
 *
 * Auth: `EventSource` cannot set custom headers, so the gateway
 * accepts the auth cookie (Supabase session) — same as the rest of
 * the owner-web fetches. No bearer token is exposed in the URL.
 */

export const COCKPIT_EVENT_KINDS = [
  'decision.recorded',
  'reminder.fired',
  'opportunity.scan_completed',
  'risk.changed',
  'workforce.shift_event',
  'compliance.deadline_approaching',
  'production.posted',
  // ── Owner-relevant cross-actor pulses (RT-1 / #194 / commercial chain).
  // The gateway broadcasts EVERY tenant-channel event to the owner stream
  // (cockpit-stream.hono.ts does not filter by kind), so this allowlist
  // MUST be a superset of the owner-targeted emitted set in
  // cockpit-events/types.ts — otherwise the owner silently drops a live
  // pulse the gateway pushed. Each kind below has EN+SW describer copy.
  'safety.incident_reported',
  'incident.escalated',
  'bid.placed',
  'bid.accepted',
  'bid.rejected',
  'payroll.committed',
  'mwikila.acted',
  'mwikila.proposes',
  'regulator.request_received',
  'task.assigned',
  'settlement.initiated',
  'licence.renewal_status_changed',
  // CT-5 — chat-driven dynamic tab CRUD cross-device sync.
  'cockpit.tab.spawned',
  'cockpit.tab.updated',
  'cockpit.tab.removed',
  'cockpit.tab.proposed',
] as const;

export type CockpitEventKind = (typeof COCKPIT_EVENT_KINDS)[number];

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
 * Commercial chain L6 — a shift report was just committed. Drives the
 * owner cockpit's live production KPI tile (ROM tonnes, metres
 * advanced, BCM overburden) without polling.
 */
export interface ProductionPostedEvent extends BaseEvent {
  readonly kind: 'production.posted';
  readonly shiftReportId: string;
  readonly siteId: string;
  readonly shiftDate: string;
  readonly romTonnes: number | null;
  readonly metresAdvanced: number | null;
  readonly bcmOverburden: number | null;
  readonly fuelLitres: number | null;
}

/**
 * Owner-relevant cross-actor pulses. These MIRROR the gateway wire types in
 * `services/api-gateway/src/services/cockpit-events/types.ts` — only the
 * fields the owner cockpit reads are declared here. The gateway pushes the
 * full envelope; unread fields are simply ignored by `parseCockpitEvent`.
 */

/** Worker reported a safety incident — owner + manager pulse. */
export interface SafetyIncidentReportedEvent extends BaseEvent {
  readonly kind: 'safety.incident_reported';
  readonly incidentId: string;
  readonly siteId: string | null;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly reportedBy: string;
  readonly summary: string;
}

/** Incident escalated up the chain — owner cockpit alert pulse. */
export interface IncidentEscalatedEvent extends BaseEvent {
  readonly kind: 'incident.escalated';
  readonly incidentId: string;
  readonly fromLevel: string;
  readonly toLevel: string;
  readonly escalatedBy: string;
}

/** Marketplace bid placed on one of the owner's listings — seller pulse. */
export interface BidPlacedEvent extends BaseEvent {
  readonly kind: 'bid.placed';
  readonly bidId: string;
  readonly parcelId: string | null;
  readonly amountTzs: number;
  readonly bidderId: string;
}

/** Seller accepted a bid — the binding offtake contract was crystallized. */
export interface BidAcceptedEvent extends BaseEvent {
  readonly kind: 'bid.accepted';
  readonly bidId: string;
  readonly listingId: string | null;
  readonly offtakeAgreementId: string | null;
  readonly buyerId: string;
}

/** Seller rejected a bid. */
export interface BidRejectedEvent extends BaseEvent {
  readonly kind: 'bid.rejected';
  readonly bidId: string;
  readonly listingId: string | null;
  readonly buyerId: string;
}

/** Payroll run committed — owner cockpit treasury pulse. */
export interface PayrollCommittedEvent extends BaseEvent {
  readonly kind: 'payroll.committed';
  readonly payrollRunId: string;
  readonly periodEnd: string;
  readonly netTotalTzs: number;
  readonly headcount: number;
  readonly committedBy: string;
}

/** Mr. Mwikila acted on the owner's behalf — "acting on your behalf" inbox. */
export interface MwikilaActedEvent extends BaseEvent {
  readonly kind: 'mwikila.acted';
  readonly actionId: string;
  readonly actionKind: string;
  readonly category: string;
  readonly delegationTier: 'T0' | 'T1' | 'T2' | 'T3';
  readonly summary: string;
}

/** Mr. Mwikila drafted a proposal awaiting the owner's approval. */
export interface MwikilaProposesEvent extends BaseEvent {
  readonly kind: 'mwikila.proposes';
  readonly actionId: string;
  readonly actionKind: string;
  readonly category: string;
  readonly delegationTier: 'T0' | 'T1' | 'T2' | 'T3';
  readonly summary: string;
}

/** Regulator DSR inbox received a new request — owner cockpit pulse. */
export interface RegulatorRequestReceivedEvent extends BaseEvent {
  readonly kind: 'regulator.request_received';
  readonly requestId: string;
  readonly regulator: 'pccb' | 'nemc' | 'eiti' | 'tmaa' | 'other';
  readonly subjectKind: string;
  readonly dueAt: string;
  readonly summaryEn: string;
  readonly summarySw: string;
}

/** Task assigned to a worker — owner visibility pulse. */
export interface TaskAssignedEvent extends BaseEvent {
  readonly kind: 'task.assigned';
  readonly taskId: string;
  readonly assigneeId: string;
  readonly assignedBy: string;
  readonly title: string;
  readonly siteId: string | null;
  readonly priority: 'low' | 'medium' | 'high' | 'urgent';
}

/** Settlement initiated — owner cockpit treasury pulse. */
export interface SettlementInitiatedEvent extends BaseEvent {
  readonly kind: 'settlement.initiated';
  readonly settlementId: string;
  readonly cooperativeId: string | null;
  readonly amountTzs: number;
  readonly initiatedBy: string;
}

/** Licence-renewal state transition — owner compliance pulse. */
export interface LicenceRenewalStatusChangedEvent extends BaseEvent {
  readonly kind: 'licence.renewal_status_changed';
  readonly licenceId: string;
  readonly licenceEventId: string;
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly daysUntilExpiry: number | null;
}

/**
 * CT-5 — chat-driven dynamic tab CRUD cross-device sync.
 *
 * Every brain-emitted `<tab_spawn>` / `<tab_update>` / `<tab_remove>` /
 * `<tab_proposal>` is broadcast on the cockpit bus so the owner's
 * OTHER devices reconcile in <500 ms without polling. `userId` lets
 * receivers filter (same tenant, different user → ignore).
 */
export interface CockpitTabSpawnedEvent extends BaseEvent {
  readonly kind: 'cockpit.tab.spawned';
  readonly userId: string;
  readonly tabId: string;
  readonly tabType: string;
  readonly title: string;
  readonly config: Record<string, unknown>;
  readonly originDeviceId: string | null;
  readonly source: 'brain' | 'owner';
}

export interface CockpitTabUpdatedEvent extends BaseEvent {
  readonly kind: 'cockpit.tab.updated';
  readonly userId: string;
  readonly tabId: string;
  readonly patch: { readonly config?: Record<string, unknown>; readonly title?: string };
  readonly originDeviceId: string | null;
  readonly source: 'brain' | 'owner';
}

export interface CockpitTabRemovedEvent extends BaseEvent {
  readonly kind: 'cockpit.tab.removed';
  readonly userId: string;
  readonly tabId: string;
  readonly originDeviceId: string | null;
  readonly source: 'brain' | 'owner';
}

export interface CockpitTabProposedEvent extends BaseEvent {
  readonly kind: 'cockpit.tab.proposed';
  readonly userId: string;
  readonly proposalId: string;
  readonly tabType: string;
  readonly title: string;
  readonly reasonEn: string;
  readonly reasonSw: string | null;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly confidence: number | null;
}

export type CockpitEvent =
  | DecisionRecordedEvent
  | ReminderFiredEvent
  | OpportunityScanCompletedEvent
  | RiskChangedEvent
  | WorkforceShiftEvent
  | ComplianceDeadlineApproachingEvent
  | ProductionPostedEvent
  | SafetyIncidentReportedEvent
  | IncidentEscalatedEvent
  | BidPlacedEvent
  | BidAcceptedEvent
  | BidRejectedEvent
  | PayrollCommittedEvent
  | MwikilaActedEvent
  | MwikilaProposesEvent
  | RegulatorRequestReceivedEvent
  | TaskAssignedEvent
  | SettlementInitiatedEvent
  | LicenceRenewalStatusChangedEvent
  | CockpitTabSpawnedEvent
  | CockpitTabUpdatedEvent
  | CockpitTabRemovedEvent
  | CockpitTabProposedEvent;

export interface CockpitStreamState {
  readonly connected: boolean;
  readonly events: ReadonlyArray<CockpitEvent>;
  readonly error: string | null;
}

const INITIAL_STATE: CockpitStreamState = {
  connected: false,
  events: [],
  error: null,
};

/** Maximum events kept in the in-memory ring. */
const MAX_EVENTS = 50;

/** Bilingual default toast copy for each event kind. */
export const COCKPIT_EVENT_COPY: Record<
  CockpitEventKind,
  { en: (e: CockpitEvent) => string; sw: (e: CockpitEvent) => string }
> = {
  'decision.recorded': {
    en: (e) =>
      fill(S.cockpitSse.decisionRecorded.en, {
        severity: (e as DecisionRecordedEvent).severity,
        subject: (e as DecisionRecordedEvent).subject,
      }),
    sw: (e) =>
      fill(S.cockpitSse.decisionRecorded.sw, {
        severity: (e as DecisionRecordedEvent).severity,
        subject: (e as DecisionRecordedEvent).subject,
      }),
  },
  'reminder.fired': {
    en: (e) =>
      fill(S.cockpitSse.reminderFired.en, {
        title: (e as ReminderFiredEvent).title,
      }),
    sw: (e) =>
      fill(S.cockpitSse.reminderFired.sw, {
        title: (e as ReminderFiredEvent).title,
      }),
  },
  'opportunity.scan_completed': {
    en: (e) =>
      fill(S.cockpitSse.opportunityScan.en, {
        count: (e as OpportunityScanCompletedEvent).opportunityCount,
      }),
    sw: (e) =>
      fill(S.cockpitSse.opportunityScan.sw, {
        count: (e as OpportunityScanCompletedEvent).opportunityCount,
      }),
  },
  'risk.changed': {
    en: (e) =>
      fill(S.cockpitSse.riskChanged.en, {
        severity: (e as RiskChangedEvent).severity,
      }),
    sw: (e) =>
      fill(S.cockpitSse.riskChanged.sw, {
        severity: (e as RiskChangedEvent).severity,
      }),
  },
  'workforce.shift_event': {
    en: (e) =>
      (e as WorkforceShiftEvent).transition === 'shift_start'
        ? S.cockpitSse.shiftStart.en
        : S.cockpitSse.shiftEnd.en,
    sw: (e) =>
      (e as WorkforceShiftEvent).transition === 'shift_start'
        ? S.cockpitSse.shiftStart.sw
        : S.cockpitSse.shiftEnd.sw,
  },
  'compliance.deadline_approaching': {
    en: (e) => {
      const ev = e as ComplianceDeadlineApproachingEvent;
      return fill(S.cockpitSse.complianceDeadline.en, {
        filingKind: ev.filingKind,
        days: ev.daysRemaining,
      });
    },
    sw: (e) => {
      const ev = e as ComplianceDeadlineApproachingEvent;
      return fill(S.cockpitSse.complianceDeadline.sw, {
        filingKind: ev.filingKind,
        days: ev.daysRemaining,
      });
    },
  },
  'production.posted': {
    en: (e) => {
      const ev = e as ProductionPostedEvent;
      const tonnes =
        ev.romTonnes != null
          ? `${ev.romTonnes}t ROM`
          : S.cockpitSse.productionShiftReport.en;
      return fill(S.cockpitSse.productionPosted.en, {
        tonnes,
        date: ev.shiftDate,
      });
    },
    sw: (e) => {
      const ev = e as ProductionPostedEvent;
      const tonnes =
        ev.romTonnes != null
          ? `${ev.romTonnes}t`
          : S.cockpitSse.productionShiftReport.sw;
      return fill(S.cockpitSse.productionPosted.sw, {
        tonnes,
        date: ev.shiftDate,
      });
    },
  },
  'safety.incident_reported': {
    en: (e) =>
      fill(E.safetyIncident.en, {
        severity: (e as SafetyIncidentReportedEvent).severity,
      }),
    sw: (e) =>
      fill(E.safetyIncident.sw, {
        severity: (e as SafetyIncidentReportedEvent).severity,
      }),
  },
  'incident.escalated': {
    en: (e) =>
      fill(E.incidentEscalated.en, {
        level: (e as IncidentEscalatedEvent).toLevel,
      }),
    sw: (e) =>
      fill(E.incidentEscalated.sw, {
        level: (e as IncidentEscalatedEvent).toLevel,
      }),
  },
  'bid.placed': {
    en: () => E.bidPlaced.en,
    sw: () => E.bidPlaced.sw,
  },
  'bid.accepted': {
    en: () => E.bidAccepted.en,
    sw: () => E.bidAccepted.sw,
  },
  'bid.rejected': {
    en: () => E.bidRejected.en,
    sw: () => E.bidRejected.sw,
  },
  'payroll.committed': {
    en: (e) =>
      fill(E.payrollCommitted.en, {
        headcount: (e as PayrollCommittedEvent).headcount,
      }),
    sw: (e) =>
      fill(E.payrollCommitted.sw, {
        headcount: (e as PayrollCommittedEvent).headcount,
      }),
  },
  'mwikila.acted': {
    en: (e) =>
      fill(E.mwikilaActed.en, {
        summary: (e as MwikilaActedEvent).summary,
      }),
    sw: (e) =>
      fill(E.mwikilaActed.sw, {
        summary: (e as MwikilaActedEvent).summary,
      }),
  },
  'mwikila.proposes': {
    en: (e) =>
      fill(E.mwikilaProposes.en, {
        summary: (e as MwikilaProposesEvent).summary,
      }),
    sw: (e) =>
      fill(E.mwikilaProposes.sw, {
        summary: (e as MwikilaProposesEvent).summary,
      }),
  },
  'regulator.request_received': {
    en: () => E.regulatorRequest.en,
    sw: () => E.regulatorRequest.sw,
  },
  'task.assigned': {
    en: (e) =>
      fill(E.taskAssigned.en, { title: (e as TaskAssignedEvent).title }),
    sw: (e) =>
      fill(E.taskAssigned.sw, { title: (e as TaskAssignedEvent).title }),
  },
  'settlement.initiated': {
    en: () => E.settlementInitiated.en,
    sw: () => E.settlementInitiated.sw,
  },
  'licence.renewal_status_changed': {
    en: (e) =>
      fill(E.licenceRenewalStatus.en, {
        status: (e as LicenceRenewalStatusChangedEvent).toStatus,
      }),
    sw: (e) =>
      fill(E.licenceRenewalStatus.sw, {
        status: (e as LicenceRenewalStatusChangedEvent).toStatus,
      }),
  },
  'cockpit.tab.spawned': {
    en: (e) =>
      fill(S.cockpitSse.tabSpawned.en, {
        title: (e as CockpitTabSpawnedEvent).title,
      }),
    sw: (e) =>
      fill(S.cockpitSse.tabSpawned.sw, {
        title: (e as CockpitTabSpawnedEvent).title,
      }),
  },
  'cockpit.tab.updated': {
    en: (e) =>
      fill(S.cockpitSse.tabUpdated.en, {
        tabId: (e as CockpitTabUpdatedEvent).tabId,
      }),
    sw: (e) =>
      fill(S.cockpitSse.tabUpdated.sw, {
        tabId: (e as CockpitTabUpdatedEvent).tabId,
      }),
  },
  'cockpit.tab.removed': {
    en: (e) =>
      fill(S.cockpitSse.tabRemoved.en, {
        tabId: (e as CockpitTabRemovedEvent).tabId,
      }),
    sw: (e) =>
      fill(S.cockpitSse.tabRemoved.sw, {
        tabId: (e as CockpitTabRemovedEvent).tabId,
      }),
  },
  'cockpit.tab.proposed': {
    en: (e) =>
      fill(S.cockpitSse.tabProposed.en, {
        title: (e as CockpitTabProposedEvent).title,
      }),
    sw: (e) =>
      fill(S.cockpitSse.tabProposed.sw, {
        title: (e as CockpitTabProposedEvent).title,
      }),
  },
};

/** Build a toast-ready message from a cockpit event. */
export function describeCockpitEvent(
  event: CockpitEvent,
  language: 'en' | 'sw' = 'en',
): string {
  const copy = COCKPIT_EVENT_COPY[event.kind];
  if (!copy) return event.kind;
  return language === 'sw' ? copy.sw(event) : copy.en(event);
}

/** Parse a raw SSE `data:` payload into a typed event (or null on bad shape). */
export function parseCockpitEvent(raw: string): CockpitEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CockpitEvent> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.kind !== 'string') return null;
    if (!COCKPIT_EVENT_KINDS.includes(parsed.kind as CockpitEventKind)) {
      return null;
    }
    if (typeof parsed.tenantId !== 'string' || parsed.tenantId.length === 0) {
      return null;
    }
    if (typeof parsed.emittedAt !== 'string') return null;
    return parsed as CockpitEvent;
  } catch {
    return null;
  }
}

export interface UseCockpitStreamOptions {
  readonly enabled?: boolean;
  readonly onEvent?: (event: CockpitEvent) => void;
}

/**
 * Subscribe to the cockpit SSE stream. Returns connection state +
 * a ring buffer of the most recent {@link MAX_EVENTS} events.
 *
 * Pass `onEvent` to flow events into a toast system. The handler
 * receives every event in arrival order; consumers should debounce
 * or rate-limit toast spawns themselves if needed.
 */
export function useCockpitStream(
  options: UseCockpitStreamOptions = {},
): CockpitStreamState {
  const enabled = options.enabled ?? true;
  const onEvent = options.onEvent;
  const [state, setState] = useState<CockpitStreamState>(INITIAL_STATE);

  useEffect(() => {
    if (!enabled) {
      setState(INITIAL_STATE);
      return undefined;
    }
    if (typeof window === 'undefined') return undefined;

    const url = `${API_BASE.replace(/\/+$/, '')}/api/v1/cockpit/stream`;
    let source: EventSource;
    try {
      source = new EventSource(url, { withCredentials: true });
    } catch (err) {
      setState({
        connected: false,
        events: [],
        error: err instanceof Error ? err.message : 'eventsource-construct-failed',
      });
      return undefined;
    }

    const handleEvent = (raw: MessageEvent): void => {
      if (typeof raw.data !== 'string') return;
      const event = parseCockpitEvent(raw.data);
      if (!event) return;
      setState((prev) => {
        const next = [...prev.events, event];
        if (next.length > MAX_EVENTS) next.splice(0, next.length - MAX_EVENTS);
        return { ...prev, connected: true, events: next, error: null };
      });
      if (onEvent) {
        try {
          onEvent(event);
        } catch {
          // toast renderer threw — do not crash the hook.
        }
      }
    };

    source.addEventListener('connected', () => {
      setState((prev) => ({ ...prev, connected: true, error: null }));
    });
    for (const kind of COCKPIT_EVENT_KINDS) {
      source.addEventListener(kind, handleEvent as EventListener);
    }
    source.addEventListener('error', () => {
      setState((prev) => ({ ...prev, connected: false }));
    });

    return () => {
      source.close();
      setState(INITIAL_STATE);
    };
  }, [enabled, onEvent]);

  return state;
}
