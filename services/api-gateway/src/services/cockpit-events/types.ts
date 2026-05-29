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
  'production.posted',
  'regulator.request_received',
  'regulator.request_status_changed',
  'inspection.narrative_status_changed',
  'licence.renewal_status_changed',
  // ── RT-1 (2026-05-29) cross-actor real-time visibility ──────────
  'rfb.dispatched',
  'task.assigned',
  'safety.incident_reported',
  'settlement.initiated',
  'payroll.committed',
  'licence.renewed',
  'chat.handoff',
  'manager.approved',
  'bid.placed',
  'incident.escalated',
  // ── CT-3/CT-5 (2026-05-29) chat-driven dynamic tab CRUD ─────────
  // Per-user cockpit bus pulses so multi-device sessions reconcile the
  // tab strip in <500 ms when the brain spawns / updates / removes a
  // tab from a different device. Scope is (tenantId, userId) — every
  // event carries the owning user so subscribers can filter.
  'cockpit.tab.spawned',
  'cockpit.tab.updated',
  'cockpit.tab.removed',
  'cockpit.tab.proposed',
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
  | MwikilaProposesEvent
  | ProductionPostedEvent
  | RegulatorRequestReceivedEvent
  | RegulatorRequestStatusChangedEvent
  | InspectionNarrativeStatusChangedEvent
  | LicenceRenewalStatusChangedEvent
  | RfbDispatchedEvent
  | TaskAssignedEvent
  | SafetyIncidentEvent
  | SettlementInitiatedEvent
  | PayrollCommittedEvent
  | LicenceRenewedEvent
  | ChatHandoffEvent
  | ManagerApprovedEvent
  | BidPlacedEvent
  | IncidentEscalatedEvent
  | CockpitTabSpawnedEvent
  | CockpitTabUpdatedEvent
  | CockpitTabRemovedEvent
  | CockpitTabProposedEvent;

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

/**
 * Commercial chain L6 — a shift report was just committed. Drives the
 * owner cockpit's live KPI tile (ROM tonnes, metres advanced, BCM
 * overburden) without polling. Numeric fields are nullable because
 * the worker may submit a partial shift report (e.g. drilling-only
 * shift with no ore extracted).
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
 * Issue #194 C-A — regulator DSR inbox just received a new request.
 * Drives the owner cockpit's "Regulator inbox" pulse tile. Pulses
 * once per request received; the status-changed event below carries
 * subsequent transitions.
 */
export interface RegulatorRequestReceivedEvent extends BaseEvent {
  readonly kind: 'regulator.request_received';
  readonly requestId: string;
  readonly regulator: 'pccb' | 'nemc' | 'eiti' | 'tmaa' | 'other';
  readonly subjectKind: string;
  readonly dueAt: string;
  readonly summaryEn: string;
  readonly summarySw: string;
}

/**
 * Issue #194 C-A — regulator request state-machine transition.
 * Mirrors the SAP S/4HANA workflow pattern (see Docs/RESEARCH/
 * REGULATOR_SOTA_2026-05-29.md §5).
 */
export interface RegulatorRequestStatusChangedEvent extends BaseEvent {
  readonly kind: 'regulator.request_status_changed';
  readonly requestId: string;
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly actorId: string;
}

/**
 * Issue #194 C-C — inspection-narrative state transition.
 *   draft → manager_ok → owner_signed → submitted → delivered.
 */
export interface InspectionNarrativeStatusChangedEvent extends BaseEvent {
  readonly kind: 'inspection.narrative_status_changed';
  readonly narrativeId: string;
  readonly inspectionId: string;
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly actorId: string;
}

/**
 * Issue #194 C-B — licence renewal state transition.
 *   drafted → submitted → acknowledged → renewed.
 */
export interface LicenceRenewalStatusChangedEvent extends BaseEvent {
  readonly kind: 'licence.renewal_status_changed';
  readonly licenceId: string;
  readonly licenceEventId: string;
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly daysUntilExpiry: number | null;
}

// ───────────────────────────────────────────────────────────────────
// RT-1 — Cross-actor real-time events (added 2026-05-29)
// Every mutating endpoint that crosses an actor boundary publishes
// one of the below so the receiving surface flips state in <200 ms.
// ───────────────────────────────────────────────────────────────────

/** Buyer-RFB dispatched to a manager for fulfilment. */
export interface RfbDispatchedEvent extends BaseEvent {
  readonly kind: 'rfb.dispatched';
  readonly rfbId: string;
  readonly managerId: string;
  readonly siteId: string;
  readonly dispatchedBy: string;
}

/** Task assigned to a worker — drives mobile inbox pulse. */
export interface TaskAssignedEvent extends BaseEvent {
  readonly kind: 'task.assigned';
  readonly taskId: string;
  readonly assigneeId: string;
  readonly assignedBy: string;
  readonly title: string;
  readonly siteId: string | null;
  readonly priority: 'low' | 'medium' | 'high' | 'urgent';
}

/** Worker reported a safety incident — owner + manager pulse. */
export interface SafetyIncidentEvent extends BaseEvent {
  readonly kind: 'safety.incident_reported';
  readonly incidentId: string;
  readonly siteId: string | null;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly reportedBy: string;
  readonly summary: string;
}

/** Cooperative settlement initiated — cooperative-mobile pulse. */
export interface SettlementInitiatedEvent extends BaseEvent {
  readonly kind: 'settlement.initiated';
  readonly settlementId: string;
  readonly cooperativeId: string | null;
  readonly amountTzs: number;
  readonly initiatedBy: string;
}

/** Payroll run committed — worker mobile pulse "you've been paid". */
export interface PayrollCommittedEvent extends BaseEvent {
  readonly kind: 'payroll.committed';
  readonly payrollRunId: string;
  readonly periodEnd: string;
  readonly netTotalTzs: number;
  readonly headcount: number;
  readonly committedBy: string;
}

/** Licence renewed (final terminal state, not a status transition). */
export interface LicenceRenewedEvent extends BaseEvent {
  readonly kind: 'licence.renewed';
  readonly licenceId: string;
  readonly licenceKind: string;
  readonly renewedThrough: string;
  readonly renewedBy: string;
}

/** Chat handed off owner → manager → junior or any chain. */
export interface ChatHandoffEvent extends BaseEvent {
  readonly kind: 'chat.handoff';
  readonly handoffId: string;
  readonly fromActor: string;
  readonly toActor: string;
  readonly reason: string;
}

/** Manager approved / rejected / deferred a request. */
export interface ManagerApprovedEvent extends BaseEvent {
  readonly kind: 'manager.approved';
  readonly approvalId: string;
  readonly subject: string;
  readonly approvedBy: string;
  readonly decision: 'approve' | 'reject' | 'defer';
}

/** Marketplace bid placed — seller surface pulse. */
export interface BidPlacedEvent extends BaseEvent {
  readonly kind: 'bid.placed';
  readonly bidId: string;
  readonly parcelId: string | null;
  readonly amountTzs: number;
  readonly bidderId: string;
}

/** Incident escalated up the chain — owner cockpit alert pulse. */
export interface IncidentEscalatedEvent extends BaseEvent {
  readonly kind: 'incident.escalated';
  readonly incidentId: string;
  readonly fromLevel: string;
  readonly toLevel: string;
  readonly escalatedBy: string;
}

// ───────────────────────────────────────────────────────────────────
// CT-3 / CT-5 — Chat-driven dynamic tab CRUD (2026-05-29)
//
// Every brain-emitted `<tab_spawn>` / `<tab_update>` / `<tab_remove>` /
// `<tab_proposal>` lands in the per-user cockpit bus. All other devices
// the owner is signed in on receive the event via the existing SSE
// channel and reconcile their tab strip in <500 ms.
// ───────────────────────────────────────────────────────────────────

/** A new tab was spawned (brain or owner click). */
export interface CockpitTabSpawnedEvent extends BaseEvent {
  readonly kind: 'cockpit.tab.spawned';
  /** Owning user id — receivers filter by `userId === auth.userId`. */
  readonly userId: string;
  /** Tab id (deterministic per FE owner-tabs-store). */
  readonly tabId: string;
  /** Tab type, e.g. `finance`, `compliance`. */
  readonly tabType: string;
  /** Render-ready title (already passes 60-char cap). */
  readonly title: string;
  /** Spawn config the FE stores. Capped at 4 KB by the validator. */
  readonly config: Record<string, unknown>;
  /** Which device originated the spawn — bus filters echo to self. */
  readonly originDeviceId: string | null;
  /** Brain-emitted (vs. owner-clicked) so the FE can show the right toast. */
  readonly source: 'brain' | 'owner';
}

/** A tab's config or title was patched. */
export interface CockpitTabUpdatedEvent extends BaseEvent {
  readonly kind: 'cockpit.tab.updated';
  readonly userId: string;
  readonly tabId: string;
  /** Patched fields only — receivers shallow-merge. */
  readonly patch: { readonly config?: Record<string, unknown>; readonly title?: string };
  readonly originDeviceId: string | null;
  readonly source: 'brain' | 'owner';
}

/** A tab was removed from the strip. */
export interface CockpitTabRemovedEvent extends BaseEvent {
  readonly kind: 'cockpit.tab.removed';
  readonly userId: string;
  readonly tabId: string;
  readonly originDeviceId: string | null;
  readonly source: 'brain' | 'owner';
}

/** A proactive proposal landed in the owner's inbox. */
export interface CockpitTabProposedEvent extends BaseEvent {
  readonly kind: 'cockpit.tab.proposed';
  readonly userId: string;
  readonly proposalId: string;
  readonly tabType: string;
  readonly title: string;
  readonly reasonEn: string;
  readonly reasonSw: string | null;
  /** ≥1 grounded id per the Borjie evidence rule. */
  readonly evidenceIds: ReadonlyArray<string>;
  readonly confidence: number | null;
}
