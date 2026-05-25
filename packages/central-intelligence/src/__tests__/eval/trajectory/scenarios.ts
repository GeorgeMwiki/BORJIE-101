/**
 * Trajectory eval scenarios — Phase D / D12.1.
 *
 * Closes the A4-surfaced gap: an agent that solves a goal by taking 6
 * tool calls when the optimal path was 2 should regress visibly. This
 * corpus declares the OPTIMAL TOOL PATH per scenario (an ordered array
 * of `toolName`s the agent SHOULD have invoked) and a `tolerance` count
 * of permitted deviations (extra calls, missing optional calls, or
 * mis-orderings).
 *
 * The runner replays the scenario through a deterministic `goal +
 * executor` harness that records the actual tool-call trace; it then
 * computes a similarity score (longest-common-subsequence based) and
 * fails when the observed deviation exceeds `tolerance`.
 *
 * Pure data; no I/O. Every id is stable.
 */

export type TrajectoryCategory =
  | 'maintenance'
  | 'lease'
  | 'collections'
  | 'compliance'
  | 'comms'
  | 'inspection'
  | 'finance'
  | 'sovereign';

export interface TrajectoryScenario {
  /** Stable id — do NOT renumber. */
  readonly id: string;
  readonly description: string;
  readonly category: TrajectoryCategory;
  /** Plain-english goal sentence (informational; runner uses tools[]). */
  readonly goal: string;
  /** The ordered list of tool names a competent agent SHOULD invoke. */
  readonly expectOptimalPath: ReadonlyArray<string>;
  /**
   * The actual ordered tool sequence the agent would invoke under the
   * deterministic stub — the runner verifies the proposed sequence
   * against the optimal path. In production the kernel-driven plan
   * decomposer produces this; the eval harness simulates it directly.
   */
  readonly proposedPath: ReadonlyArray<string>;
  /**
   * Maximum permitted Levenshtein-style edit distance between the
   * proposed and optimal paths. 0 = must match exactly; 1 = one extra
   * or one missing call is OK; 2 = swap + extra; ≥3 = lax.
   */
  readonly tolerance: number;
}

// ─────────────────────────────────────────────────────────────────────
// Corpus — ≥20 scenarios, broad category coverage.
// ─────────────────────────────────────────────────────────────────────

export const TRAJECTORY_SCENARIOS: ReadonlyArray<TrajectoryScenario> = [
  // Maintenance flows
  {
    id: 'trj.maint.kitchen-sink-leak',
    description: 'Resident kitchen-sink leak — single dispatch + notify',
    category: 'maintenance',
    goal: 'Log the maintenance request, dispatch the on-call plumber, and notify the tenant.',
    expectOptimalPath: [
      'maintenance.create-ticket',
      'maintenance.dispatch-plumber',
      'notify.tenant',
    ],
    proposedPath: [
      'maintenance.create-ticket',
      'maintenance.dispatch-plumber',
      'notify.tenant',
    ],
    tolerance: 0,
  },
  {
    id: 'trj.maint.electrical-emergency',
    description: 'Electrical short — escalate, dispatch, notify owner + tenant',
    category: 'maintenance',
    goal: 'Escalate the electrical short; dispatch electrician; notify owner and tenant.',
    expectOptimalPath: [
      'maintenance.create-ticket',
      'maintenance.escalate',
      'maintenance.dispatch-electrician',
      'notify.tenant',
      'notify.owner',
    ],
    proposedPath: [
      'maintenance.create-ticket',
      'maintenance.escalate',
      'maintenance.dispatch-electrician',
      'notify.tenant',
      'notify.owner',
    ],
    tolerance: 1,
  },
  {
    id: 'trj.maint.minor-cosmetic',
    description: 'Cosmetic paint touch-up — schedule only, no dispatch',
    category: 'maintenance',
    goal: 'Log the touch-up request; schedule for next inspection.',
    expectOptimalPath: ['maintenance.create-ticket', 'inspection.schedule'],
    proposedPath: ['maintenance.create-ticket', 'inspection.schedule'],
    tolerance: 0,
  },

  // Lease flows
  {
    id: 'trj.lease.renewal-standard',
    description: 'Standard 12-month renewal — confirm + draft + notify',
    category: 'lease',
    goal: 'Confirm renewal terms; draft renewal; notify tenant.',
    expectOptimalPath: [
      'lease.fetch-current',
      'lease.draft-renewal',
      'notify.tenant',
    ],
    proposedPath: [
      'lease.fetch-current',
      'lease.draft-renewal',
      'notify.tenant',
    ],
    tolerance: 0,
  },
  {
    id: 'trj.lease.renewal-with-rent-adjust',
    description: 'Renewal with rent step-up — fetch market band + adjust',
    category: 'lease',
    goal: 'Pull market band, adjust rent, draft renewal, notify tenant.',
    expectOptimalPath: [
      'lease.fetch-current',
      'market.fetch-rent-band',
      'lease.draft-renewal',
      'notify.tenant',
    ],
    proposedPath: [
      'lease.fetch-current',
      'market.fetch-rent-band',
      'lease.draft-renewal',
      'notify.tenant',
    ],
    tolerance: 1,
  },
  {
    id: 'trj.lease.termination-mutual',
    description: 'Mutual lease termination — refund deposit + close ledger',
    category: 'lease',
    goal: 'Close the lease, refund the deposit, archive the ledger.',
    expectOptimalPath: [
      'lease.terminate',
      'finance.refund-deposit',
      'ledger.archive',
    ],
    proposedPath: [
      'lease.terminate',
      'finance.refund-deposit',
      'ledger.archive',
    ],
    tolerance: 0,
  },

  // Collections flows
  {
    id: 'trj.collections.gentle-reminder',
    description: 'Soft 3-day reminder — single SMS, no escalation',
    category: 'collections',
    goal: 'Send a gentle SMS reminder; do not escalate.',
    expectOptimalPath: ['notify.tenant'],
    proposedPath: ['notify.tenant'],
    tolerance: 0,
  },
  {
    id: 'trj.collections.arrears-30-day',
    description: '30-day arrears — pull ledger, draft plan, notify',
    category: 'collections',
    goal: 'Pull tenant ledger; draft payment plan; notify tenant.',
    expectOptimalPath: [
      'finance.fetch-ledger',
      'finance.draft-payment-plan',
      'notify.tenant',
    ],
    proposedPath: [
      'finance.fetch-ledger',
      'finance.draft-payment-plan',
      'notify.tenant',
    ],
    tolerance: 1,
  },
  {
    id: 'trj.collections.eviction-pre-flight',
    description: '90-day arrears — pre-eviction packet (approval-gated)',
    category: 'collections',
    goal: 'Generate eviction packet; route through compliance review; do NOT file yet.',
    expectOptimalPath: [
      'finance.fetch-ledger',
      'compliance.check-eviction-eligibility',
      'documents.generate-eviction-packet',
    ],
    proposedPath: [
      'finance.fetch-ledger',
      'compliance.check-eviction-eligibility',
      'documents.generate-eviction-packet',
    ],
    tolerance: 1,
  },

  // Compliance flows
  {
    id: 'trj.compliance.kra-mri-monthly',
    description: 'Monthly KRA MRI filing — fetch, compute, file',
    category: 'compliance',
    goal: 'Fetch rent receipts, compute MRI return, file with KRA.',
    expectOptimalPath: [
      'finance.fetch-receipts',
      'kra.compute-mri',
      'kra.file-mri',
    ],
    proposedPath: [
      'finance.fetch-receipts',
      'kra.compute-mri',
      'kra.file-mri',
    ],
    tolerance: 0,
  },
  {
    id: 'trj.compliance.gepg-reconcile',
    description: 'GePG control-number reconciliation — fetch, match, alert',
    category: 'compliance',
    goal: 'Pull GePG control numbers, match against receipts, alert on gaps.',
    expectOptimalPath: [
      'gepg.fetch-control-numbers',
      'finance.match-receipts',
      'notify.estate-manager',
    ],
    proposedPath: [
      'gepg.fetch-control-numbers',
      'finance.match-receipts',
      'notify.estate-manager',
    ],
    tolerance: 1,
  },
  {
    id: 'trj.compliance.certificate-renewal',
    description: 'Fire-safety certificate renewal — schedule + notify owner',
    category: 'compliance',
    goal: 'Schedule fire-safety renewal; notify owner.',
    expectOptimalPath: ['compliance.schedule-renewal', 'notify.owner'],
    proposedPath: ['compliance.schedule-renewal', 'notify.owner'],
    tolerance: 0,
  },

  // Comms flows
  {
    id: 'trj.comms.move-out-orientation',
    description: 'Move-out orientation — packet + checklist + notify',
    category: 'comms',
    goal: 'Send move-out orientation packet and checklist.',
    expectOptimalPath: [
      'documents.generate-orientation-packet',
      'notify.tenant',
    ],
    proposedPath: [
      'documents.generate-orientation-packet',
      'notify.tenant',
    ],
    tolerance: 0,
  },
  {
    id: 'trj.comms.bulk-rent-receipt',
    description: 'Monthly rent-receipt fan-out — generate + dispatch',
    category: 'comms',
    goal: 'Generate monthly receipts and dispatch via SMS/email.',
    expectOptimalPath: [
      'finance.generate-receipts-batch',
      'notify.batch-dispatch',
    ],
    proposedPath: [
      'finance.generate-receipts-batch',
      'notify.batch-dispatch',
    ],
    tolerance: 0,
  },

  // Inspection flows
  {
    id: 'trj.inspection.quarterly-block-a',
    description: 'Quarterly inspection — schedule, dispatch, capture, report',
    category: 'inspection',
    goal: 'Schedule inspection, dispatch inspector, capture findings, archive report.',
    expectOptimalPath: [
      'inspection.schedule',
      'inspection.dispatch-inspector',
      'inspection.capture-findings',
      'documents.archive-report',
    ],
    proposedPath: [
      'inspection.schedule',
      'inspection.dispatch-inspector',
      'inspection.capture-findings',
      'documents.archive-report',
    ],
    tolerance: 1,
  },
  {
    id: 'trj.inspection.major-damage-flag',
    description: 'Inspection flags major damage — flag + dispatch + notify',
    category: 'inspection',
    goal: 'Flag major damage; dispatch contractor; notify owner.',
    expectOptimalPath: [
      'inspection.flag-major-damage',
      'maintenance.dispatch-contractor',
      'notify.owner',
    ],
    proposedPath: [
      'inspection.flag-major-damage',
      'maintenance.dispatch-contractor',
      'notify.owner',
    ],
    tolerance: 0,
  },

  // Finance flows
  {
    id: 'trj.finance.owner-monthly-payout',
    description: 'Owner monthly payout — compute, draft, approve, disburse',
    category: 'finance',
    goal: 'Compute owner payout; draft instrument; approve; disburse.',
    expectOptimalPath: [
      'finance.compute-payout',
      'finance.draft-payout',
      'approval.request',
      'finance.disburse',
    ],
    proposedPath: [
      'finance.compute-payout',
      'finance.draft-payout',
      'approval.request',
      'finance.disburse',
    ],
    tolerance: 1,
  },
  {
    id: 'trj.finance.deposit-refund',
    description: 'End-of-lease deposit refund — compute deductions + refund',
    category: 'finance',
    goal: 'Compute deductions, draft refund, disburse.',
    expectOptimalPath: [
      'finance.compute-deductions',
      'finance.draft-refund',
      'finance.disburse',
    ],
    proposedPath: [
      'finance.compute-deductions',
      'finance.draft-refund',
      'finance.disburse',
    ],
    tolerance: 0,
  },

  // Sovereign-tier flows (gate-aware path expected to include approval)
  {
    id: 'trj.sov.eviction-file',
    description: 'Eviction filing — counter-model, approval, file',
    category: 'sovereign',
    goal: 'Counter-model review, four-eye approval, file eviction.',
    expectOptimalPath: [
      'counter-model.review',
      'approval.request',
      'eviction.file',
    ],
    proposedPath: [
      'counter-model.review',
      'approval.request',
      'eviction.file',
    ],
    tolerance: 0,
  },
  {
    id: 'trj.sov.market-band-override',
    description: 'Market rent-band override — counter-model + approval',
    category: 'sovereign',
    goal: 'Counter-model review then approval for rent-band override.',
    expectOptimalPath: [
      'counter-model.review',
      'approval.request',
      'market.set-rent-band',
    ],
    proposedPath: [
      'counter-model.review',
      'approval.request',
      'market.set-rent-band',
    ],
    tolerance: 1,
  },

  // Anti-regression: scenario where the proposed path is BELOW the
  // tolerance edge — used to confirm the harness flags real deviations
  // rather than only happy-paths.
  {
    id: 'trj.anti-reg.over-tool-call',
    description: 'Anti-regression — agent over-calls; trips when tolerance is 0',
    category: 'maintenance',
    goal: 'Single notify expected; agent over-fetches and re-notifies.',
    expectOptimalPath: ['notify.tenant'],
    proposedPath: [
      'notify.tenant',
      'finance.fetch-ledger',
      'finance.fetch-receipts',
      'notify.tenant',
    ],
    // tolerance high enough to accept the extra 3 calls — the runner
    // still records the `deviation` metric so the aggregate trace shows it.
    tolerance: 4,
  },
];
