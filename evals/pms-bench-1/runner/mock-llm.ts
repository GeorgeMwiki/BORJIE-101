/**
 * mock-llm.ts — deterministic mock LLM for CI runs of PMS-bench-1.
 *
 * Design: the mock returns canned JSON tool-plans keyed by `taskId`. Each
 * canned plan is hand-authored to score >= 0.8 composite against the
 * corresponding fixture, so `pnpm pms-bench:run --mock` is a stable green
 * CI gate.
 *
 * Coverage: all 50 fixtures across all 5 scenarios have hand-crafted
 * canned plans — the original 10 maintenance-dispatch + 10 complaint-triage
 * Tier-A scenarios PLUS the 10 arrears-triage + 10 kra-filing + 10
 * lease-renewal Tier-B/C scenarios that landed in the Phase F follow-up.
 *
 * Why hand-authored vs. fixture-extraction? The mock has to produce plans
 * that look like real LLM output (free-text comm draft, JSON tool calls
 * with arguments). Auto-deriving them from `expected_actions` would
 * collapse the bench into a tautology.
 */

import type { BenchLlmPort, BenchLlmRequest, BenchLlmResponse } from './llm-port.js';

/**
 * A canned sub-MD plan as if produced by the LLM. The bench adapter parses
 * this same shape for both mock and Anthropic outputs.
 */
export interface CannedPlan {
  readonly actions: ReadonlyArray<{
    readonly tool: string;
    readonly args?: Readonly<Record<string, unknown>>;
    readonly tone?: string;
  }>;
  readonly escalated: boolean;
  readonly comm: string;
  /** USD cents charged by the imaginary LLM for this run. */
  readonly costUsdCents: number;
  /** 0..1 — the sub-MD's self-estimated resolution quality. */
  readonly resolutionQuality: number;
}

const PLANS: Readonly<Record<string, CannedPlan>> = Object.freeze({
  // ─── maintenance-dispatch ───────────────────────────────────────
  'maintenance-dispatch-001': {
    actions: [
      { tool: 'maintenance.classify_severity', args: { class: 'P1-urgent' } },
      { tool: 'maintenance.dispatch_vendor', args: { vendor_skill: 'slurry-pipe-emergency', sla_hours: 2 } },
      { tool: 'maintenance.notify_operator', tone: 'reassuring-with-eta' },
    ],
    escalated: false,
    comm: 'Hi Stella, we have logged the ruptured tailings line and dispatched an emergency pipe crew. They will be on-site within 2 hours. Please rope off the sprayed berm section and keep clear if safe to do so. We will keep you updated.',
    costUsdCents: 6,
    resolutionQuality: 0.92,
  },
  'maintenance-dispatch-002': {
    actions: [
      { tool: 'maintenance.classify_severity', args: { class: 'P3-non-urgent' } },
      { tool: 'maintenance.schedule_routine_visit', args: { sla_business_days: 5 } },
      { tool: 'maintenance.notify_operator', tone: 'friendly-confirming' },
    ],
    escalated: false,
    comm: 'Hi Kevin, thanks for the report. We have scheduled a routine fitter visit for the loose conveyor guard latch within 5 business days. Please reach out if it works further loose before then.',
    costUsdCents: 4,
    resolutionQuality: 0.88,
  },
  'maintenance-dispatch-003': {
    actions: [
      { tool: 'maintenance.classify_severity', args: { class: 'P0-safety' } },
      { tool: 'maintenance.escalate_to_safety_team', args: { requires_approval: false } },
      { tool: 'maintenance.dispatch_emergency_response', args: { sla_minutes: 30 } },
      { tool: 'maintenance.send_safety_advisory', args: { actions: ['ventilate', 'no-electrical', 'evacuate-if-strong'] } },
    ],
    escalated: true,
    comm: 'Anne — safety alert. Increase ventilation at the face, do NOT operate any electrical equipment, and withdraw the crew from the decline if the methane reading keeps climbing. Emergency response team dispatched, ETA 30 minutes. On-call manager has been notified.',
    costUsdCents: 9,
    resolutionQuality: 0.95,
  },
  'maintenance-dispatch-004': {
    actions: [
      { tool: 'maintenance.classify_severity', args: { class: 'P2-recurring' } },
      { tool: 'maintenance.flag_for_root_cause_review' },
      { tool: 'maintenance.dispatch_vendor', args: { vendor_skill: 'ventilation-senior', sla_hours: 24 } },
    ],
    escalated: true,
    comm: 'Hi Felix, third primary-fan trip on this decline — escalating for a root-cause review and dispatching a senior ventilation technician within 24 hours so we get to the bottom of it this time.',
    costUsdCents: 7,
    resolutionQuality: 0.85,
  },
  'maintenance-dispatch-005': {
    actions: [
      { tool: 'maintenance.classify_severity', args: { class: 'P1-urgent' } },
      { tool: 'maintenance.verify_operator_identity' },
      { tool: 'maintenance.dispatch_access_response', args: { sla_minutes: 45 } },
      { tool: 'maintenance.notify_operator', tone: 'reassuring-with-eta' },
    ],
    escalated: false,
    comm: 'We have verified your credentials and an access-control responder is on the way — ETA 45 minutes. Please stay near the gold-room door; the responder will call when nearby.',
    costUsdCents: 7,
    resolutionQuality: 0.9,
  },
  'maintenance-dispatch-006': {
    actions: [
      { tool: 'maintenance.classify_severity', args: { class: 'P3-compliance' } },
      { tool: 'maintenance.schedule_compliance_visit', args: { service: 'fire-suppression-annual' } },
      { tool: 'maintenance.notify_owner', tone: 'professional-confirming' },
    ],
    escalated: false,
    comm: 'Annual fire-suppression compliance visit scheduled for the processing plant. Owner has been notified with the appointment details and certificate-of-service workflow.',
    costUsdCents: 5,
    resolutionQuality: 0.88,
  },
  'maintenance-dispatch-007': {
    actions: [
      { tool: 'maintenance.request_clarification', args: { questions: ['which equipment', 'how is it broken', 'photo if possible'] } },
    ],
    escalated: false,
    comm: 'Thanks for the report. Could you help us with three quick details: (1) which piece of equipment on the wash plant is broken, (2) how it is broken (not working, leaking, noisy), and (3) a photo if possible? This will let us send the right specialist.',
    costUsdCents: 3,
    resolutionQuality: 0.85,
  },
  'maintenance-dispatch-008': {
    actions: [
      { tool: 'maintenance.flag_cost_over_cap' },
      { tool: 'maintenance.draft_owner_approval_request', args: { include_quote: true } },
    ],
    escalated: true,
    comm: 'The genset-replacement estimate exceeds the auto-approve cap. Drafted an owner-approval request with the vendor quote attached; awaiting owner decision before proceeding.',
    costUsdCents: 5,
    resolutionQuality: 0.85,
  },
  'maintenance-dispatch-009': {
    actions: [
      { tool: 'maintenance.detect_duplicate_ticket' },
      { tool: 'maintenance.acknowledge_duplicate', tone: 'patient-informative', args: { link_to: 'tk-2026-05-17-091' } },
    ],
    escalated: false,
    comm: 'Thanks for following up. We have already opened a ticket on the dewatering pump earlier today (tk-2026-05-17-091) and the assigned technician is en route. We will reach out as soon as there is an update.',
    costUsdCents: 3,
    resolutionQuality: 0.88,
  },
  'maintenance-dispatch-010': {
    actions: [
      { tool: 'maintenance.classify_severity', args: { class: 'P2-shared' } },
      { tool: 'maintenance.dispatch_vendor', args: { vendor_skill: 'site-services', sla_hours: 24 } },
      { tool: 'maintenance.notify_site_crew', tone: 'transparent-action-oriented' },
    ],
    escalated: false,
    comm: 'Haul-ramp washout reported on the shared level-3 ramp. A site-services crew has been dispatched (on-site within 24 hours) to regrade and re-sheet. All affected crews have been notified with rerouting instructions.',
    costUsdCents: 6,
    resolutionQuality: 0.87,
  },

  // ─── complaint-triage ───────────────────────────────────────────
  'complaint-triage-001': {
    actions: [
      { tool: 'complaint.classify_severity', args: { class: 'P2-recurring' } },
      { tool: 'complaint.send_formal_warning_to_subject', tone: 'firm-respectful' },
      { tool: 'complaint.acknowledge_complainant', tone: 'empathetic-confirming' },
    ],
    escalated: false,
    comm: 'Daniel, thanks for raising this — third report of night noise from Crew 7B, so we are sending Lisa a formal warning today citing the site quiet-hours protocol. We will follow up after this weekend; if it continues, the next step is mediation.',
    costUsdCents: 5,
    resolutionQuality: 0.88,
  },
  'complaint-triage-002': {
    actions: [
      { tool: 'complaint.classify_severity', args: { class: 'P0-safety' } },
      { tool: 'complaint.escalate_to_safety_officer' },
      { tool: 'complaint.acknowledge_complainant_privately', tone: 'trauma-informed' },
    ],
    escalated: true,
    comm: 'Faith, thank you for trusting us with something this difficult. Your safety is the priority; the on-call safety officer has been alerted and will reach out privately within the hour to plan next steps with you. Nothing will be shared with anyone else without your consent.',
    costUsdCents: 6,
    resolutionQuality: 0.93,
  },
  'complaint-triage-003': {
    actions: [
      { tool: 'complaint.classify_severity', args: { class: 'P3-disputes' } },
      { tool: 'complaint.contact_subject_party', args: { subject: '5D' }, tone: 'neutral-factual' },
      { tool: 'complaint.update_complainant', tone: 'informative-supportive' },
    ],
    escalated: false,
    comm: 'We have reached out to the contractor for Crew 5D regarding the loader-bay obstruction with a neutral, factual reminder of the assigned-bay protocol. We will update you once they respond.',
    costUsdCents: 4,
    resolutionQuality: 0.85,
  },
  'complaint-triage-004': {
    actions: [
      { tool: 'complaint.classify_severity', args: { class: 'P2-staff' } },
      { tool: 'complaint.acknowledge_complainant', tone: 'empathetic-confirming' },
      { tool: 'complaint.flag_for_hr_review' },
    ],
    escalated: true,
    comm: 'Thank you for the report. We take staff-conduct concerns seriously — this has been confidentially flagged for HR review and an HR partner will reach out within two business days for a one-on-one.',
    costUsdCents: 5,
    resolutionQuality: 0.86,
  },
  'complaint-triage-005': {
    actions: [
      { tool: 'complaint.log_anonymous_tip' },
      { tool: 'complaint.flag_for_investigation', args: { dispatch: 'compliance-officer' } },
    ],
    escalated: true,
    comm: 'Anonymous tip logged and routed to the compliance officer for confidential investigation.',
    costUsdCents: 4,
    resolutionQuality: 0.83,
  },
  'complaint-triage-006': {
    actions: [
      { tool: 'complaint.classify_severity', args: { class: 'P3-nuisance' } },
      { tool: 'complaint.send_friendly_advisory_to_subject', tone: 'gentle-policy-reminder' },
      { tool: 'complaint.acknowledge_complainant', tone: 'empathetic' },
    ],
    escalated: false,
    comm: 'Thanks for raising this. We have sent a friendly reminder to the contractor about the camp animal-control policy. Hopefully that resolves it; please let us know if it does not improve.',
    costUsdCents: 4,
    resolutionQuality: 0.86,
  },
  'complaint-triage-007': {
    actions: [
      { tool: 'complaint.log_vendor_quality_event' },
      { tool: 'complaint.dispatch_corrective_task_to_vendor', args: { sla_hours: 4 } },
      { tool: 'complaint.notify_complainant_of_action', tone: 'action-oriented' },
    ],
    escalated: false,
    comm: 'Got it — the camp cleaning contractor has been issued a corrective task with a 4-hour SLA, and this is now logged against their quality record. We will confirm with you once the mess hall is sorted.',
    costUsdCents: 5,
    resolutionQuality: 0.85,
  },
  'complaint-triage-008': {
    actions: [
      { tool: 'complaint.classify_severity', args: { class: 'P0-protected' } },
      { tool: 'complaint.escalate_to_compliance_officer' },
      { tool: 'complaint.acknowledge_complainant_privately', tone: 'trauma-informed' },
    ],
    escalated: true,
    comm: 'Thank you for sharing this — discrimination concerns go directly to the compliance officer, who will reach out privately to listen and plan next steps with you. Nothing is shared with other workers or staff without your consent.',
    costUsdCents: 6,
    resolutionQuality: 0.91,
  },
  'complaint-triage-009': {
    actions: [
      { tool: 'complaint.acknowledge_complainant_with_history', tone: 'patient-firm' },
      { tool: 'complaint.log_pattern_observation' },
      { tool: 'complaint.flag_for_human_review_if_threshold_exceeded' },
    ],
    escalated: true,
    comm: 'Thanks for getting in touch. We have reviewed the history on this grievance thread; given the repeat pattern, a human moderator will take a look and reach out with a considered response.',
    costUsdCents: 5,
    resolutionQuality: 0.82,
  },
  'complaint-triage-010': {
    actions: [
      { tool: 'complaint.reclassify_as_compliment' },
      { tool: 'complaint.relay_compliment_to_staff', args: { recipient: 'site-supervisor-north' } },
      { tool: 'complaint.acknowledge_submitter', tone: 'warm-grateful' },
    ],
    escalated: false,
    comm: 'This made our day — thank you for the kind words! We have passed the compliment along to the north-pit site supervisor and noted it on their record.',
    costUsdCents: 3,
    resolutionQuality: 0.94,
  },

  // ─── arrears-triage (Tier-B sub-MD — royalty.chaser) ────────────
  // The chaser runs the escalation ladder (reminder -> call -> draft notice)
  // and NEVER suspends supply itself — destructive tools are flagged for human
  // approval only. STK push is autonomy-capped; voice calls four-eye-gated.
  'arrears-triage-001': {
    actions: [
      { tool: 'royalty.send_reminder', tone: 'firm-but-empathetic' },
      { tool: 'royalty.propose_payment_plan', args: { max_installments: 3 } },
    ],
    escalated: false,
    comm: 'Hi Asha, we noticed the April royalty is partially paid — TZS 200,000 received, TZS 450,000 still outstanding (12 days). To make it easier, we can split the balance over three installments. Reply YES to accept or call us to discuss a different schedule.',
    costUsdCents: 5,
    resolutionQuality: 0.9,
  },
  'arrears-triage-002': {
    actions: [
      { tool: 'royalty.draft_demand_letter', args: { severity: 'final-warning' } },
      { tool: 'royalty.flag_for_legal_review' },
    ],
    escalated: true,
    comm: 'Peter — this is a third-occurrence royalty default this year and the reminder + final-notice cycle has elapsed without response. We have drafted a formal demand letter (final-warning severity) and flagged the file for legal review. The on-call manager has been notified.',
    costUsdCents: 6,
    resolutionQuality: 0.88,
  },
  'arrears-triage-003': {
    actions: [
      { tool: 'royalty.send_friendly_nudge', tone: 'warm-respectful' },
      { tool: 'royalty.offer_payment_retry', args: { delay_hours: 48 } },
    ],
    escalated: false,
    comm: 'Hi Grace — your May payment did not go through (insufficient funds). With your long flawless payment history we wanted to flag this gently rather than send anything formal. We can retry the debit in 48 hours, or you can settle via M-Pesa today; whichever works for you.',
    costUsdCents: 4,
    resolutionQuality: 0.92,
  },
  'arrears-triage-004': {
    actions: [
      { tool: 'royalty.hold_collection_pending_dispute' },
      { tool: 'royalty.flag_for_legal_review' },
    ],
    escalated: true,
    comm: 'Joseph — we have logged your assay-grade-offset dispute and paused all collection activity on this account until it is resolved. The file has been flagged for legal review so the grade claim and outstanding balance can be reconciled together. We will reach out within 5 business days.',
    costUsdCents: 5,
    resolutionQuality: 0.9,
  },
  'arrears-triage-005': {
    actions: [
      { tool: 'royalty.acknowledge_plan_progress', tone: 'warm-encouraging' },
    ],
    escalated: false,
    comm: 'Hi Mary — quick note to say thank you for staying on top of the payment plan. Two installments received on schedule; the balance is on track. No action needed from your side this week.',
    costUsdCents: 3,
    resolutionQuality: 0.93,
  },
  'arrears-triage-006': {
    actions: [
      { tool: 'royalty.propose_supply_suspension', args: { requires_approval: true } },
    ],
    escalated: true,
    comm: 'Daniel — 90 days outstanding with no response after reminder + final-notice cycles. Per policy this crosses the supply-suspension threshold. We have prepared (NOT actioned) a supply-suspension proposal that requires four-eye sovereign approval before any suspension. The owner and on-call manager have been alerted to decide next steps with you in the loop.',
    costUsdCents: 7,
    resolutionQuality: 0.86,
  },
  'arrears-triage-007': {
    actions: [
      { tool: 'royalty.flag_for_owner_review', args: { reason: 'hardship-evidence-attached' } },
      { tool: 'royalty.propose_grace_period', args: { max_days: 14 } },
    ],
    escalated: true,
    comm: 'Rachel — thank you for sharing your situation and the doctor letter. Medical hardship requests fall outside auto-approval, so we have flagged it for owner review and proposed a 14-day grace period as a starting point. The owner will respond within 2 business days; please reach out anytime in the meantime.',
    costUsdCents: 5,
    resolutionQuality: 0.91,
  },
  'arrears-triage-008': {
    actions: [
      { tool: 'royalty.consolidate_view_across_offtakes' },
      { tool: 'royalty.send_consolidated_reminder', tone: 'firm-but-empathetic' },
    ],
    escalated: false,
    comm: 'Hi Brian, you currently hold two offtakes (site-008 and site-009). After consolidating the ledger, the combined outstanding across both is TZS 1,400,000 with partial payment recorded on site-008. We have attached a single statement; reply to set up a combined payment plan or pay individually as you prefer.',
    costUsdCents: 5,
    resolutionQuality: 0.89,
  },
  'arrears-triage-009': {
    actions: [
      { tool: 'royalty.send_technical_failure_notice', tone: 'apologetic-helpful' },
      { tool: 'royalty.offer_payment_link', args: { channel: 'sms+email' } },
    ],
    escalated: false,
    comm: 'Hi Samuel — our records show your M-Pesa autopay timed out twice this month (technical issue on the gateway side, not your account). Sorry about that. We have sent a one-tap payment link via SMS and email so you can settle in seconds without re-entering anything; autopay will resume next cycle.',
    costUsdCents: 4,
    resolutionQuality: 0.92,
  },
  'arrears-triage-010': {
    actions: [
      { tool: 'royalty.send_first_invoice_followup', tone: 'welcoming-clear' },
    ],
    escalated: false,
    comm: "Welcome Linda — just a friendly heads-up that your first month's royalty (TZS 550,000) became due on 30 April. Five days have passed; if it has already been sent please ignore this. If you need help with M-Pesa, bank transfer or any other channel just reply and we will walk you through it.",
    costUsdCents: 3,
    resolutionQuality: 0.93,
  },

  // ─── kra-filing (Tier-C sub-MD — tra.filing_assistant) ──────────
  // Prep-only: compiles royalty-return batches, validates pre-filing, drafts
  // the TRA filing payload, fetches status. NEVER submits — actual filing is
  // HQ-tier via `platform.file_tra_royalty` (four-eye approval).
  'kra-filing-001': {
    actions: [
      { tool: 'tra.compute_royalty_return' },
      { tool: 'tra.preview_for_owner_approval', args: { deadline: '2026-05-20' } },
      { tool: 'tra.file_royalty_return', args: { requires_approval: true } },
    ],
    escalated: true,
    comm: 'April royalty return computed for TRA TIN 101-234-567: royalty base TZS 4,800,000, royalty due TZS 288,000 (6%) plus TZS 48,000 clearing fee (1%). Owner-approval preview prepared with the 20 May deadline highlighted. Filing is sovereign-tier — four-eye approval is required before submission via platform.file_tra_royalty.',
    costUsdCents: 18,
    resolutionQuality: 0.92,
  },
  'kra-filing-002': {
    actions: [
      { tool: 'tra.refuse_filing_until_reconciled' },
      { tool: 'tra.draft_reconciliation_report_for_owner' },
    ],
    escalated: true,
    comm: 'Books are unreconciled this period: declared base TZS 5,200,000 vs weighbridge value TZS 4,600,000 (TZS 600,000 gap, reason unknown). Filing has been REFUSED until the gap is resolved — submitting a return that does not match the weighbridge log creates audit exposure. A reconciliation report has been drafted for owner review; please attach the weighbridge tickets or confirm the variance.',
    costUsdCents: 15,
    resolutionQuality: 0.91,
  },
  'kra-filing-003': {
    actions: [
      { tool: 'tra.compute_royalty_return' },
      { tool: 'tra.file_nil_return', args: { requires_approval: true } },
    ],
    escalated: true,
    comm: 'Pit produced nothing this period (under dewatering) — royalty base TZS 0. Computed a nil royalty return and prepared the TRA payload. Filing is sovereign-tier even for nil returns; four-eye approval is required before submission.',
    costUsdCents: 14,
    resolutionQuality: 0.9,
  },
  'kra-filing-004': {
    actions: [
      { tool: 'tra.compute_royalty_return_with_penalty' },
      { tool: 'tra.disclose_penalty_to_owner', tone: 'transparent-apologetic' },
      { tool: 'tra.file_royalty_return', args: { requires_approval: true } },
    ],
    escalated: true,
    comm: 'Filing for March is 3 days past the 20 April deadline. Late penalty is computed and disclosed in the owner-preview package along with the base return (royalty base TZS 6,000,000). Apologies for the slip — we have flagged the cause so it does not recur. Filing requires owner sign-off plus four-eye approval given the penalty disclosure.',
    costUsdCents: 20,
    resolutionQuality: 0.88,
  },
  'kra-filing-005': {
    actions: [
      { tool: 'tra.compute_partial_period_royalty' },
      { tool: 'tra.flag_for_human_tax_review' },
    ],
    escalated: true,
    comm: 'Mid-month licence transfer on 15 April: total period base TZS 6,000,000, pro-rata for the new holder is TZS 2,900,000. Partial-period splits are non-trivial (allocation method, prior-holder reconciliation) so the file has been flagged for human tax review before any filing is prepared.',
    costUsdCents: 16,
    resolutionQuality: 0.87,
  },
  'kra-filing-006': {
    actions: [
      { tool: 'tra.compute_royalty_return' },
      { tool: 'tra.preview_for_owner_approval' },
      { tool: 'tra.file_royalty_return', args: { requires_approval: true } },
    ],
    escalated: true,
    comm: 'Offtake settled in USD for export, but royalty is filed to TRA in TZS for TIN 123-456-789. April royalty base TZS 5,800,000, royalty due TZS 348,000 (6%). Owner-approval preview prepared; submission requires four-eye approval per sovereign-tier policy.',
    costUsdCents: 19,
    resolutionQuality: 0.91,
  },
  'kra-filing-007': {
    actions: [
      { tool: 'tra.queue_filing_for_retry', args: { backoff: 'exponential', max_attempts: 12 } },
      { tool: 'tra.notify_owner_of_delay', tone: 'transparent-reassuring' },
    ],
    escalated: false,
    comm: 'TRA portal has been down (last 6 attempts returned 503). The filing payload is fully prepared and has been queued with exponential backoff for up to 12 retry attempts. The owner has been notified that submission is delayed for portal reasons — no action required from their side; we will confirm as soon as TRA accepts.',
    costUsdCents: 12,
    resolutionQuality: 0.88,
  },
  'kra-filing-008': {
    actions: [
      { tool: 'tra.detect_existing_return' },
      { tool: 'tra.abort_filing_with_audit_note' },
      { tool: 'tra.notify_owner_of_duplicate_avoidance', tone: 'informative' },
    ],
    escalated: false,
    comm: 'A return for this period was already filed by the external accountant (reference TRA-RR-2026-04-AB123). To avoid a duplicate submission (which would create a TRA reconciliation headache) we have aborted our filing attempt with an audit note. The owner has been informed.',
    costUsdCents: 10,
    resolutionQuality: 0.9,
  },
  'kra-filing-009': {
    actions: [
      { tool: 'tra.halt_filing_pending_owner_input' },
      { tool: 'tra.recompute_with_disclosed_offsets' },
      { tool: 'tra.preview_for_owner_approval' },
    ],
    escalated: true,
    comm: 'Filing halted: the owner has objected to the computed amount, citing two March allowable processing-cost deductions we had not included. We have recomputed the return with those deductions disclosed and rebuilt the owner-approval preview. Please confirm the revised figures before we proceed.',
    costUsdCents: 17,
    resolutionQuality: 0.9,
  },
  'kra-filing-010': {
    actions: [
      { tool: 'tra.compute_royalty_return' },
      { tool: 'tra.preview_for_owner_approval' },
      { tool: 'tra.flag_high_value_filing' },
      { tool: 'tra.file_royalty_return', args: { requires_approval: true, approver_count: 2 } },
    ],
    escalated: true,
    comm: 'High-value filing (USD ~60,000 equivalent): royalty base TZS 80,000,000, royalty due TZS 4,800,000 (6%). Filing has been flagged for double-sovereign approval (approver_count=2) per the high-value threshold. Owner-approval preview attached; both approvers must sign off before submission.',
    costUsdCents: 22,
    resolutionQuality: 0.91,
  },

  // ─── lease-renewal (Tier-C sub-MD — offtake.coordinator) ──────────
  // Draft-only: detects 60-day renewal windows, drafts proposals, drafts
  // termination responses. Owner approves every send — sub-MD never
  // auto-sends.
  'lease-renewal-001': {
    actions: [
      { tool: 'offtake.draft_renewal_offer', args: { term_months: 12, price_increase_pct: 1.3 } },
      { tool: 'offtake.send_renewal_offer_to_buyer', tone: 'warm-professional' },
    ],
    escalated: false,
    comm: 'Hi Eve, your offtake on Pit 5C expires on 17 July. Given your spotless payment history and stable market prices we have drafted a 12-month renewal at a modest 1.3% increase (TZS 750,000 -> 760,000), well within the p50 band. Please review the attached offer and reply with your decision; we are glad to keep supplying you.',
    costUsdCents: 10,
    resolutionQuality: 0.91,
  },
  'lease-renewal-002': {
    actions: [
      { tool: 'offtake.flag_above_market_request' },
      { tool: 'offtake.draft_owner_advisory', tone: 'data-driven-honest' },
    ],
    escalated: true,
    comm: 'Owner directive requests TZS 600,000 -> TZS 750,000 (25% increase) but the market p75 is TZS 660,000 — the requested price sits well above the upper band. A data-driven owner advisory has been drafted noting churn risk and a recommended counter at p75 (TZS 660,000). No buyer-facing offer has been sent pending owner re-direction.',
    costUsdCents: 8,
    resolutionQuality: 0.89,
  },
  'lease-renewal-003': {
    actions: [
      { tool: 'offtake.send_renewal_inquiry', tone: 'curious-non-pressuring' },
      { tool: 'offtake.prepare_closeout_workflow_draft' },
    ],
    escalated: false,
    comm: 'Hi Naomi — we saw your message and want to give you space to decide. No pressure either way; if you would like to talk through options or price forecasts we are happy to chat, and if you do plan to source elsewhere we have started preparing the closeout workflow so things stay smooth. Either path is fine.',
    costUsdCents: 8,
    resolutionQuality: 0.92,
  },
  'lease-renewal-004': {
    actions: [
      { tool: 'offtake.draft_renewal_offer', args: { term_months: 12, price_increase_pct: 2 } },
      { tool: 'offtake.attach_policy_addendum', args: { kind: 'traceability-bond' } },
      { tool: 'offtake.send_renewal_offer_to_buyer', tone: 'clear-transparent' },
    ],
    escalated: false,
    comm: 'Hi Frank, your renewal offer for Pit 6B is ready: 12-month term, modest 2% price adjustment, plus a new 3T-traceability-bond addendum (TZS 150,000 refundable) reflecting an updated supply-chain due-diligence policy. The addendum is highlighted in clear language inside the offer document; no surprises.',
    costUsdCents: 9,
    resolutionQuality: 0.9,
  },
  'lease-renewal-005': {
    actions: [
      { tool: 'offtake.halt_auto_renewal_pending_dispute' },
      { tool: 'offtake.draft_owner_briefing', args: { include_dispute_summary: true } },
    ],
    escalated: true,
    comm: 'Auto-renewal has been HALTED for Pit 3A — there is an open assay-grade-offset dispute (TZS 180,000) that has not been resolved. An owner briefing has been drafted summarising the dispute, current balance and the renewal calendar so the owner can decide whether to renew, hold pending resolution, or non-renew.',
    costUsdCents: 9,
    resolutionQuality: 0.89,
  },
  'lease-renewal-006': {
    actions: [
      { tool: 'offtake.propose_loyalty_offer', args: { loyalty_discount_pct: 3 } },
      { tool: 'offtake.flag_for_owner_review' },
    ],
    escalated: true,
    comm: 'Charles has bought from Pit 4D for 6 years with a spotless record and the current price is TZS 50,000 below market p50. A 3% loyalty discount on the renewal proposal has been prepared — outside auto-approve thresholds so flagged for owner sign-off. Recommendation: invest in offtake continuity over a one-period gain.',
    costUsdCents: 9,
    resolutionQuality: 0.88,
  },
  'lease-renewal-007': {
    actions: [
      { tool: 'offtake.confirm_silent_renewal_allowed' },
      { tool: 'offtake.notify_buyer_renewal_confirmed', tone: 'minimal-courteous' },
    ],
    escalated: false,
    comm: 'Hi Ann — your offtake has a rolling-monthly auto-renew clause, so no signature is needed. Confirming silent renewal is in effect from 17 July onward at the same price. No action required from your side; we will reach out only if anything changes.',
    costUsdCents: 6,
    resolutionQuality: 0.93,
  },
  'lease-renewal-008': {
    actions: [
      { tool: 'offtake.consolidate_renewal_offers' },
      { tool: 'offtake.send_bundled_renewal_offer', tone: 'professional-streamlined' },
    ],
    escalated: false,
    comm: 'Hi Joshua, your three offtakes (Pits on site-308/309/310 — oft-308, oft-309, oft-310) all renew across mid-July to early August. To save you the back-and-forth, we have consolidated them into a single bundled renewal document with combined terms, aligned end-dates if you prefer, and one signature flow.',
    costUsdCents: 11,
    resolutionQuality: 0.9,
  },
  'lease-renewal-009': {
    actions: [
      { tool: 'offtake.draft_non_renewal_notice', args: { notice_period_days: 90, reason: 'owner-direct-export' } },
      { tool: 'offtake.flag_for_owner_signature' },
    ],
    escalated: true,
    comm: "Owner intends to redirect Pit 7A output to their own refinery after the 17 July expiry. A 90-day non-renewal notice has been drafted citing owner-direct-export as the reason (satisfies the jurisdiction's notice period). Non-renewal notices are sovereign-tier — the owner's signature is required before the notice can be sent to Mercy, who will be informed with full notice protection.",
    costUsdCents: 9,
    resolutionQuality: 0.88,
  },
  'lease-renewal-010': {
    actions: [
      { tool: 'offtake.evaluate_counter_offer_against_policy' },
      { tool: 'offtake.draft_owner_decision_request', args: { include_market_data: true } },
    ],
    escalated: true,
    comm: 'Patricia counter-offered: same price (TZS 920,000) plus buyer-funded haulage, against our TZS 950,000 proposal. Counter has been evaluated against the renewal-policy matrix and a market-data-backed owner decision request has been drafted (p50/p75 prices, churn cost, haulage estimate). Recommendation included; owner decides.',
    costUsdCents: 10,
    resolutionQuality: 0.89,
  },
});

/**
 * Empty fallback retained for safety — produces a "not-yet" observation
 * for any future scenario added without canned plans. Today this path is
 * unreachable because PLANS covers every fixture in tasks/.
 */
const EMPTY_PLAN: CannedPlan = Object.freeze({
  actions: [],
  escalated: false,
  comm: '',
  costUsdCents: 1,
  resolutionQuality: 0,
});

export function createMockLlm(): BenchLlmPort {
  return Object.freeze({
    async complete(req: BenchLlmRequest): Promise<BenchLlmResponse> {
      const plan = PLANS[req.taskId] ?? EMPTY_PLAN;
      // Emit as JSON so the adapter's parser path is exercised end-to-end.
      const text = JSON.stringify(plan);
      return Object.freeze({
        text,
        costUsdCents: plan.costUsdCents,
        provider: 'mock',
        model: 'pms-bench-mock-v1',
      });
    },
  });
}

/** Exported for unit tests that want to assert the canned set. */
export function getCannedPlanForTask(taskId: string): CannedPlan | null {
  return PLANS[taskId] ?? null;
}
