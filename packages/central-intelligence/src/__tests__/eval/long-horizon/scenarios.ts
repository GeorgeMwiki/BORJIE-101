/**
 * Long-horizon eval scenarios — Phase D / D12.3.
 *
 * Closes the A4-surfaced gap: long-horizon plans (10+ turns) degrade
 * silently — by turn 5 the agent has forgotten the original intent or
 * confused step ordering. Each scenario declares a 10-15 turn goal AND
 * the ordered sub-steps; the runner walks the plan and checks that
 * EVERY sub-step's `mustCarryContext` substring is honoured by the
 * agent's per-turn output.
 *
 * Pure data; ≥10 scenarios; ids stable.
 */

export type LongHorizonCategory =
  | 'inspection-cycle'
  | 'renewal-cycle'
  | 'eviction-cycle'
  | 'compliance-cycle'
  | 'payout-cycle'
  | 'onboarding-cycle';

export interface LongHorizonTurn {
  readonly turn: number;
  readonly description: string;
  /** Substring the agent's per-turn output MUST contain (case-insensitive). */
  readonly mustCarryContext: string;
}

export interface LongHorizonScenario {
  /** Stable id — do NOT renumber. */
  readonly id: string;
  readonly category: LongHorizonCategory;
  readonly description: string;
  /** Plain-english goal that spans the full multi-turn arc. */
  readonly goal: string;
  /** Ordered turn-by-turn breakdown (10-15 entries). */
  readonly turns: ReadonlyArray<LongHorizonTurn>;
}

export const LONG_HORIZON_SCENARIOS: ReadonlyArray<LongHorizonScenario> = [
  {
    id: 'lh.inspection.full-cycle',
    category: 'inspection-cycle',
    description: 'Full property-inspection cycle from confirm to archive',
    goal:
      'Schedule a property inspection: confirm date with owner, notify tenant, dispatch inspector, attach photos, generate report, send to owner, archive in vault, schedule follow-up.',
    turns: [
      { turn: 1, description: 'Confirm inspection window with owner', mustCarryContext: 'inspection' },
      { turn: 2, description: 'Notify tenant of inspection date', mustCarryContext: 'inspection' },
      { turn: 3, description: 'Dispatch inspector with checklist', mustCarryContext: 'inspector' },
      { turn: 4, description: 'Capture findings photos', mustCarryContext: 'photos' },
      { turn: 5, description: 'Score findings against rubric', mustCarryContext: 'findings' },
      { turn: 6, description: 'Generate written inspection report', mustCarryContext: 'report' },
      { turn: 7, description: 'Send report to owner', mustCarryContext: 'owner' },
      { turn: 8, description: 'Acknowledge tenant of completion', mustCarryContext: 'tenant' },
      { turn: 9, description: 'Archive report in document vault', mustCarryContext: 'archive' },
      { turn: 10, description: 'Schedule follow-up inspection date', mustCarryContext: 'follow-up' },
    ],
  },
  {
    id: 'lh.renewal.full-cycle',
    category: 'renewal-cycle',
    description: 'Full lease-renewal cycle from market check to signed',
    goal:
      'Renew lease: pull market band, draft revised terms, run owner review, send to tenant, negotiate, finalise terms, generate contract, collect signatures, archive, schedule first rent reminder.',
    turns: [
      { turn: 1, description: 'Pull current market rent band', mustCarryContext: 'market' },
      { turn: 2, description: 'Compute renewal proposed rent', mustCarryContext: 'rent' },
      { turn: 3, description: 'Draft revised lease terms', mustCarryContext: 'lease' },
      { turn: 4, description: 'Owner reviews drafted terms', mustCarryContext: 'owner' },
      { turn: 5, description: 'Send proposed terms to tenant', mustCarryContext: 'tenant' },
      { turn: 6, description: 'Receive tenant counter-offer', mustCarryContext: 'counter' },
      { turn: 7, description: 'Negotiate compromise rent', mustCarryContext: 'negotiate' },
      { turn: 8, description: 'Finalise lease terms', mustCarryContext: 'final' },
      { turn: 9, description: 'Generate signed contract', mustCarryContext: 'contract' },
      { turn: 10, description: 'Collect signatures from both parties', mustCarryContext: 'signature' },
      { turn: 11, description: 'Archive signed contract in vault', mustCarryContext: 'archive' },
      { turn: 12, description: 'Schedule first rent reminder', mustCarryContext: 'rent' },
    ],
  },
  {
    id: 'lh.eviction.full-cycle',
    category: 'eviction-cycle',
    description: 'Eviction with all gate + audit hops',
    goal:
      'Process an eviction: pull arrears ledger, validate notice eligibility, draft notice, counter-model review, four-eye approval, file notice, serve tenant, document service, schedule hearing, archive audit trail.',
    turns: [
      { turn: 1, description: 'Pull tenant arrears ledger', mustCarryContext: 'arrears' },
      { turn: 2, description: 'Validate eviction eligibility', mustCarryContext: 'eligibility' },
      { turn: 3, description: 'Draft eviction notice', mustCarryContext: 'notice' },
      { turn: 4, description: 'Counter-model reviews notice', mustCarryContext: 'counter-model' },
      { turn: 5, description: 'Request four-eye approval', mustCarryContext: 'approval' },
      { turn: 6, description: 'File notice with court', mustCarryContext: 'file' },
      { turn: 7, description: 'Serve tenant with notice', mustCarryContext: 'serve' },
      { turn: 8, description: 'Document service proof', mustCarryContext: 'proof' },
      { turn: 9, description: 'Schedule court hearing', mustCarryContext: 'hearing' },
      { turn: 10, description: 'Archive full audit trail', mustCarryContext: 'audit' },
    ],
  },
  {
    id: 'lh.compliance.kra-mri-monthly',
    category: 'compliance-cycle',
    description: 'Full KRA MRI monthly cycle',
    goal:
      'File the monthly KRA MRI return: pull rent receipts, reconcile against GePG, compute MRI return, generate filing PDF, owner sign-off, submit to KRA, capture KRA reference, archive, schedule next month reminder, notify owner.',
    turns: [
      { turn: 1, description: 'Pull rent receipts for the month', mustCarryContext: 'receipts' },
      { turn: 2, description: 'Reconcile receipts vs GePG control numbers', mustCarryContext: 'reconcile' },
      { turn: 3, description: 'Compute MRI return totals', mustCarryContext: 'mri' },
      { turn: 4, description: 'Generate the filing PDF', mustCarryContext: 'pdf' },
      { turn: 5, description: 'Owner reviews and signs off', mustCarryContext: 'owner' },
      { turn: 6, description: 'Submit return to KRA', mustCarryContext: 'kra' },
      { turn: 7, description: 'Capture KRA reference number', mustCarryContext: 'reference' },
      { turn: 8, description: 'Archive filing in vault', mustCarryContext: 'archive' },
      { turn: 9, description: 'Schedule next-month reminder', mustCarryContext: 'reminder' },
      { turn: 10, description: 'Notify owner of successful filing', mustCarryContext: 'notify' },
    ],
  },
  {
    id: 'lh.payout.owner-monthly',
    category: 'payout-cycle',
    description: 'Owner monthly payout end-to-end',
    goal:
      'Run the owner monthly payout: aggregate net rent, deduct fees, draft payout instrument, sovereign-tier counter-model, four-eye approval, M-Pesa disbursement, capture receipt, ledger update, notify owner, archive statement.',
    turns: [
      { turn: 1, description: 'Aggregate net rent collected', mustCarryContext: 'rent' },
      { turn: 2, description: 'Deduct management fees', mustCarryContext: 'fees' },
      { turn: 3, description: 'Compute final payout amount', mustCarryContext: 'payout' },
      { turn: 4, description: 'Draft payout instrument', mustCarryContext: 'instrument' },
      { turn: 5, description: 'Counter-model reviews payout', mustCarryContext: 'counter-model' },
      { turn: 6, description: 'Request four-eye approval', mustCarryContext: 'approval' },
      { turn: 7, description: 'Disburse via M-Pesa', mustCarryContext: 'm-pesa' },
      { turn: 8, description: 'Capture disbursement receipt', mustCarryContext: 'receipt' },
      { turn: 9, description: 'Update owner ledger', mustCarryContext: 'ledger' },
      { turn: 10, description: 'Notify owner of payout completion', mustCarryContext: 'owner' },
      { turn: 11, description: 'Archive monthly statement', mustCarryContext: 'archive' },
    ],
  },
  {
    id: 'lh.onboarding.new-tenant',
    category: 'onboarding-cycle',
    description: 'Full new-tenant onboarding cycle',
    goal:
      'Onboard a new tenant: capture application, run KYC, credit check, generate lease, sign, collect deposit, issue keys, schedule move-in inspection, send orientation packet, schedule rent reminder, archive.',
    turns: [
      { turn: 1, description: 'Capture tenant application', mustCarryContext: 'application' },
      { turn: 2, description: 'Run KYC verification', mustCarryContext: 'kyc' },
      { turn: 3, description: 'Run credit / arrears check', mustCarryContext: 'credit' },
      { turn: 4, description: 'Generate lease contract', mustCarryContext: 'lease' },
      { turn: 5, description: 'Collect signatures', mustCarryContext: 'signature' },
      { turn: 6, description: 'Collect deposit', mustCarryContext: 'deposit' },
      { turn: 7, description: 'Issue keys', mustCarryContext: 'keys' },
      { turn: 8, description: 'Schedule move-in inspection', mustCarryContext: 'inspection' },
      { turn: 9, description: 'Send orientation packet', mustCarryContext: 'orientation' },
      { turn: 10, description: 'Schedule first rent reminder', mustCarryContext: 'rent' },
      { turn: 11, description: 'Archive onboarding records', mustCarryContext: 'archive' },
    ],
  },
  {
    id: 'lh.compliance.certificate-renewal',
    category: 'compliance-cycle',
    description: 'Fire-safety certificate renewal cycle',
    goal:
      'Renew fire-safety certificate: detect expiry, notify owner, book inspection, dispatch inspector, capture findings, submit to authority, capture certificate id, archive, notify tenants, schedule next renewal reminder.',
    turns: [
      { turn: 1, description: 'Detect certificate expiry window', mustCarryContext: 'expiry' },
      { turn: 2, description: 'Notify owner of renewal need', mustCarryContext: 'owner' },
      { turn: 3, description: 'Book renewal inspection', mustCarryContext: 'inspection' },
      { turn: 4, description: 'Dispatch fire inspector', mustCarryContext: 'inspector' },
      { turn: 5, description: 'Capture inspection findings', mustCarryContext: 'findings' },
      { turn: 6, description: 'Submit findings to authority', mustCarryContext: 'authority' },
      { turn: 7, description: 'Capture new certificate id', mustCarryContext: 'certificate' },
      { turn: 8, description: 'Archive certificate', mustCarryContext: 'archive' },
      { turn: 9, description: 'Notify tenants of renewed certificate', mustCarryContext: 'tenant' },
      { turn: 10, description: 'Schedule next-cycle reminder', mustCarryContext: 'reminder' },
    ],
  },
  {
    id: 'lh.inspection.major-damage-followup',
    category: 'inspection-cycle',
    description: 'Major-damage flag follow-up cycle',
    goal:
      'Handle a major-damage flag: capture flag, escalate, dispatch contractor, scope works, draft estimate, owner approves, dispatch crew, capture work-done evidence, re-inspect, close ticket.',
    turns: [
      { turn: 1, description: 'Capture major-damage flag', mustCarryContext: 'damage' },
      { turn: 2, description: 'Escalate to estate manager', mustCarryContext: 'escalate' },
      { turn: 3, description: 'Dispatch surveying contractor', mustCarryContext: 'contractor' },
      { turn: 4, description: 'Scope works needed', mustCarryContext: 'scope' },
      { turn: 5, description: 'Draft repair estimate', mustCarryContext: 'estimate' },
      { turn: 6, description: 'Owner approves estimate', mustCarryContext: 'owner' },
      { turn: 7, description: 'Dispatch repair crew', mustCarryContext: 'crew' },
      { turn: 8, description: 'Capture work-done evidence', mustCarryContext: 'evidence' },
      { turn: 9, description: 'Re-inspect for completion', mustCarryContext: 'inspect' },
      { turn: 10, description: 'Close the major-damage ticket', mustCarryContext: 'close' },
    ],
  },
  {
    id: 'lh.renewal.with-rent-step-up',
    category: 'renewal-cycle',
    description: 'Renewal with documented rent step-up',
    goal:
      'Process renewal with rent step-up: detect renewal window, fetch market, compute step-up, owner concur, draft new terms, send to tenant, capture acceptance, generate contract, sign, archive.',
    turns: [
      { turn: 1, description: 'Detect renewal window opening', mustCarryContext: 'renewal' },
      { turn: 2, description: 'Fetch current market rent', mustCarryContext: 'market' },
      { turn: 3, description: 'Compute step-up amount', mustCarryContext: 'step-up' },
      { turn: 4, description: 'Owner concurs with proposed step-up', mustCarryContext: 'owner' },
      { turn: 5, description: 'Draft new terms', mustCarryContext: 'terms' },
      { turn: 6, description: 'Send to tenant for review', mustCarryContext: 'tenant' },
      { turn: 7, description: 'Capture tenant acceptance', mustCarryContext: 'acceptance' },
      { turn: 8, description: 'Generate signed contract', mustCarryContext: 'contract' },
      { turn: 9, description: 'Collect signatures', mustCarryContext: 'signature' },
      { turn: 10, description: 'Archive in vault', mustCarryContext: 'archive' },
    ],
  },
  {
    id: 'lh.eviction.with-mediation',
    category: 'eviction-cycle',
    description: 'Eviction halted at mediation step',
    goal:
      'Run eviction with mediation: pull arrears, validate, draft notice, offer mediation, capture mediation outcome, draft payment plan, escrow first instalment, monitor compliance, archive case, notify owner.',
    turns: [
      { turn: 1, description: 'Pull arrears ledger', mustCarryContext: 'arrears' },
      { turn: 2, description: 'Validate eligibility', mustCarryContext: 'eligibility' },
      { turn: 3, description: 'Draft pre-notice', mustCarryContext: 'notice' },
      { turn: 4, description: 'Offer mediation session', mustCarryContext: 'mediation' },
      { turn: 5, description: 'Capture mediation outcome', mustCarryContext: 'outcome' },
      { turn: 6, description: 'Draft payment plan', mustCarryContext: 'plan' },
      { turn: 7, description: 'Escrow first instalment', mustCarryContext: 'escrow' },
      { turn: 8, description: 'Monitor plan compliance', mustCarryContext: 'compliance' },
      { turn: 9, description: 'Archive case', mustCarryContext: 'archive' },
      { turn: 10, description: 'Notify owner of outcome', mustCarryContext: 'owner' },
    ],
  },
];
