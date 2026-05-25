/**
 * Sandbox Scenarios — 5 guided walks Mr. Mwikila offers to prospects who
 * say "show me how it works". Each scenario is self-contained, runs
 * against a sandbox estate, and takes 60-90 seconds to complete.
 *
 * Scenarios return a deterministic sequence of narrated steps + a final
 * summary. They do NOT call the real workflow engine — they run the
 * decision logic in-memory against the sandbox data so the prospect
 * sees the thinking without engaging production systems.
 */

import type {
  SandboxArrearsCase,
  SandboxEstate,
  SandboxMaintenanceTicket,
  SandboxRenewal,
} from './sandbox-estate-generator.js';

export type ScenarioId =
  | 'arrears_triage_u7'
  | 'owner_report_draft'
  | 'route_leaking_roof'
  | 'renewal_proposal_u12'
  | 'mpesa_reconcile';

export interface ScenarioStep {
  readonly order: number;
  readonly narration: string;
  readonly dataSnapshot?: unknown;
}

export interface ScenarioRun {
  readonly scenarioId: ScenarioId;
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly ScenarioStep[];
  readonly suggestedNext: string;
}

export const SCENARIO_CATALOG: ReadonlyArray<{
  readonly id: ScenarioId;
  readonly title: string;
  readonly description: string;
  readonly prospectPrompt: string;
}> = [
  {
    id: 'arrears_triage_u7',
    title: 'Handle the tenant in Unit 7 who is 45 days late',
    description:
      'Watch Mr. Mwikila cascade reminders, propose a payment plan, and escalate only the stubborn case.',
    prospectPrompt: 'Show me how you handle a 45-day-late tenant.',
  },
  {
    id: 'owner_report_draft',
    title: "Draft next month's owner report",
    description:
      'See a full owner report generated from live sandbox data in under 90 seconds.',
    prospectPrompt: "Draft next month's owner report.",
  },
  {
    id: 'route_leaking_roof',
    title: 'Route the leaking-roof complaint',
    description:
      'Watch the maintenance triage classify, prioritise, and dispatch a vendor in real time.',
    prospectPrompt: 'A tenant just reported a leaking roof. Walk me through it.',
  },
  {
    id: 'renewal_proposal_u12',
    title: 'Generate a renewal proposal for unit 12',
    description:
      'See the renewal model use local comps, tenant 5P score, and market drift to draft a fair proposal.',
    prospectPrompt: 'Generate a renewal proposal for unit 12.',
  },
  {
    id: 'mpesa_reconcile',
    title: "Reconcile last month's M-Pesa collections",
    description:
      'Watch the reconciliation engine match mobile-money deposits to invoices and flag the stragglers.',
    prospectPrompt: "Reconcile last month's M-Pesa collections.",
  },
];

// ============================================================================
// Scenario runners — pure functions over the sandbox estate.
// ============================================================================

export function runScenario(
  id: ScenarioId,
  estate: SandboxEstate
): ScenarioRun {
  switch (id) {
    case 'arrears_triage_u7':
      return runArrearsTriage(estate);
    case 'owner_report_draft':
      return runOwnerReportDraft(estate);
    case 'route_leaking_roof':
      return runLeakingRoofTriage(estate);
    case 'renewal_proposal_u12':
      return runRenewalProposal(estate);
    case 'mpesa_reconcile':
      return runMpesaReconcile(estate);
    default: {
      // Exhaustiveness guard — should never hit in practice.
      const _never: never = id;
      throw new Error(`Unknown scenario: ${String(_never)}`);
    }
  }
}

function pickArrearsCase(estate: SandboxEstate): SandboxArrearsCase | undefined {
  // Prefer the case closest to 45 days late to fit the "unit 7" prompt.
  const sorted = [...estate.arrears].sort(
    (a, b) => Math.abs(a.daysLate - 45) - Math.abs(b.daysLate - 45)
  );
  return sorted[0];
}

function runArrearsTriage(estate: SandboxEstate): ScenarioRun {
  const target = pickArrearsCase(estate);
  if (!target) {
    return {
      scenarioId: 'arrears_triage_u7',
      title: 'Arrears triage',
      summary: 'No arrears cases in this sandbox — all tenants paid up.',
      steps: [],
      suggestedNext: 'Try the maintenance routing scenario instead.',
    };
  }
  const fmt = currencyFormat(estate.currency);
  const steps: ScenarioStep[] = [
    {
      order: 1,
      narration: `I found the case: ${target.tenantName} in unit linked to ${target.unitId}, ${target.daysLate} days late, ${fmt(target.amountOutstanding)} outstanding.`,
    },
    {
      order: 2,
      narration:
        target.daysLate < 20
          ? 'First move: automated WhatsApp reminder with a one-tap M-Pesa deep-link. 70% of cases at this stage self-resolve within 48 hours.'
          : target.daysLate < 40
            ? `Second cascade: I draft a payment-plan proposal splitting ${fmt(target.amountOutstanding)} into two instalments over 21 days. Tenant accepts in one tap.`
            : `Third cascade: I escalate. Payment plan is still offered, but I also draft the formal demand letter per ${estate.country} tenancy law — ready for your signature.`,
    },
    {
      order: 3,
      narration: `Tenant 5P score is logged so a dispute is traceable. I link the case to the lease document so you have one-click context.`,
    },
    {
      order: 4,
      narration: `Recommendation: ${target.recommendedAction.replace('_', ' ')}. You review my draft, approve, and it dispatches — or you edit the tone and I learn.`,
      dataSnapshot: target,
    },
  ];
  return {
    scenarioId: 'arrears_triage_u7',
    title: 'Arrears triage',
    summary: `Triaged ${target.tenantName} — ${target.daysLate} days late. Recommended ${target.recommendedAction.replace('_', ' ')}.`,
    steps,
    suggestedNext: 'Want to see how the same case plays out if the tenant goes silent?',
  };
}

function runOwnerReportDraft(estate: SandboxEstate): ScenarioRun {
  const fmt = currencyFormat(estate.currency);
  const totalRent = estate.units
    .filter((u) => u.occupied)
    .reduce((s, u) => s + u.monthlyRent, 0);
  const totalArrears = estate.arrears.reduce((s, a) => s + a.amountOutstanding, 0);
  const occupancy = Math.round(
    (estate.units.filter((u) => u.occupied).length / estate.units.length) * 1000
  ) / 10;
  const steps: ScenarioStep[] = [
    {
      order: 1,
      narration: `Pulled ${estate.units.length} units, ${estate.units.filter((u) => u.occupied).length} occupied (${occupancy}%).`,
    },
    {
      order: 2,
      narration: `Rent roll this month: ${fmt(totalRent)} invoiced. Collected to date: ${fmt(totalRent - totalArrears)}. Outstanding: ${fmt(totalArrears)} across ${estate.arrears.length} cases.`,
    },
    {
      order: 3,
      narration: `Maintenance: ${estate.maintenance.length} tickets logged, ${estate.maintenance.filter((m) => m.status === 'resolved').length} resolved, ${estate.maintenance.filter((m) => m.priority === 'emergency').length} emergencies actioned.`,
    },
    {
      order: 4,
      narration: `Compliance: ${estate.compliance.length} notice${estate.compliance.length === 1 ? '' : 's'} pending — ${estate.compliance[0]?.title}.`,
    },
    {
      order: 5,
      narration: 'Report compiled as a 3-page PDF with an executive summary, line items, and a "what I recommend next month" section. Ready for your signature.',
    },
  ];
  return {
    scenarioId: 'owner_report_draft',
    title: "Owner report draft",
    summary: `Report drafted: ${occupancy}% occupancy, ${fmt(totalRent)} billed, ${fmt(totalArrears)} outstanding.`,
    steps,
    suggestedNext: 'Want to see how the report auto-schedules for the 1st of every month?',
  };
}

function runLeakingRoofTriage(estate: SandboxEstate): ScenarioRun {
  const ticket: SandboxMaintenanceTicket | undefined =
    estate.maintenance.find((m) => m.category === 'structural') ??
    estate.maintenance[0];
  const steps: ScenarioStep[] = [
    {
      order: 1,
      narration: 'Tenant sends a WhatsApp: "The roof is leaking in the master bedroom." Photo attached.',
    },
    {
      order: 2,
      narration: `I classify: structural + water damage = high priority. I ask the tenant 2 clarifying questions (is the ceiling bulging? is the leak active?) to decide if it is an emergency.`,
    },
    {
      order: 3,
      narration: ticket
        ? `Ticket ${ticket.id} opened with priority ${ticket.priority}. Vendor candidate: ${ticket.assignedVendor ?? 'FundiPro (next available)'}.`
        : 'Ticket opened with priority high. Vendor candidate: FundiPro (next available).',
    },
    {
      order: 4,
      narration: `I notify the owner with the quote range (${estate.currency} 80k - 220k typical for your area), and ask for approval before dispatch.`,
    },
    {
      order: 5,
      narration: 'Once approved, vendor is dispatched, photos are uploaded on completion, and the invoice flows to the ledger. Total human time: ~90 seconds of your attention.',
    },
  ];
  return {
    scenarioId: 'route_leaking_roof',
    title: 'Leaking-roof triage',
    summary: 'Leaking roof classified, vendor shortlisted, owner approval requested.',
    steps,
    suggestedNext: 'Want to see what happens if the tenant disputes the repair cost later?',
  };
}

function runRenewalProposal(estate: SandboxEstate): ScenarioRun {
  const renewal: SandboxRenewal | undefined = estate.renewals[0];
  if (!renewal) {
    return {
      scenarioId: 'renewal_proposal_u12',
      title: 'Renewal proposal',
      summary: 'No active renewals in this sandbox.',
      steps: [],
      suggestedNext: 'Try the arrears scenario.',
    };
  }
  const fmt = currencyFormat(estate.currency);
  const pct = Math.round(((renewal.proposedRent - renewal.currentRent) / renewal.currentRent) * 1000) / 10;
  const steps: ScenarioStep[] = [
    {
      order: 1,
      narration: `Lease for ${renewal.tenantName} expires in 21 days. Current rent: ${fmt(renewal.currentRent)}/month.`,
    },
    {
      order: 2,
      narration: `I pull local comps from our index: similar units in ${estate.estateName} are renting at a 5-9% lift year-on-year.`,
    },
    {
      order: 3,
      narration: `Tenant 5P score is strong (on-time 11 of 12 months, no disputes). I propose a ${pct}% lift, which lands at ${fmt(renewal.proposedRent)}.`,
    },
    {
      order: 4,
      narration: 'I draft the renewal letter in English + Swahili, attach the lease addendum, and prepare a one-tap accept link for the tenant.',
    },
    {
      order: 5,
      narration: 'If they counter, I model the counter against your vacancy-cost and recommend accept/reject with a one-line rationale.',
    },
  ];
  return {
    scenarioId: 'renewal_proposal_u12',
    title: 'Renewal proposal',
    summary: `Proposed ${pct}% lift to ${fmt(renewal.proposedRent)} for ${renewal.tenantName}.`,
    steps,
    suggestedNext: 'Want to see how I handle a tenant counter-offer?',
  };
}

function runMpesaReconcile(estate: SandboxEstate): ScenarioRun {
  const fmt = currencyFormat(estate.currency);
  const totalBilled = estate.units
    .filter((u) => u.occupied)
    .reduce((s, u) => s + u.monthlyRent, 0);
  const outstanding = estate.arrears.reduce((s, a) => s + a.amountOutstanding, 0);
  const matched = Math.max(0, totalBilled - outstanding);
  const steps: ScenarioStep[] = [
    {
      order: 1,
      narration: `I pull last month's M-Pesa/Airtel/Azam statements (CSV or direct API). Total inbound: ${fmt(matched)}.`,
    },
    {
      order: 2,
      narration: `I match deposits to invoices by (amount ± 50, tenant phone hash, reference code). Match rate is typically 92-96% automatic.`,
    },
    {
      order: 3,
      narration: `Unmatched rows surface with candidate invoices ranked. You pick in 2 clicks, or I propose the best and you approve.`,
    },
    {
      order: 4,
      narration: `Net: ${fmt(matched)} cleanly matched, ${fmt(outstanding)} still outstanding across ${estate.arrears.length} cases — the arrears queue.`,
    },
    {
      order: 5,
      narration: 'The full reconciliation is exported to your accountant in TRA/KRA-ready format with one click.',
    },
  ];
  return {
    scenarioId: 'mpesa_reconcile',
    title: 'M-Pesa reconciliation',
    summary: `Matched ${fmt(matched)}; ${estate.arrears.length} cases remain in arrears.`,
    steps,
    suggestedNext: 'Want to see how I handle partial payments on a lease plan?',
  };
}

function currencyFormat(currency: 'KES' | 'TZS' | 'UGX'): (n: number) => string {
  // Bare 'en' locale — only thousands separators matter in sandbox demos.
  // Follow-up KI-005 (Docs/TODO_BACKLOG.md): take tenant.defaultLocale when sandbox gets it — blocked
  // on tenants-table migration. See Docs/KNOWN_ISSUES.md#ki-005.
  return (n: number) => `${currency} ${Math.round(n).toLocaleString('en')}`;
}
