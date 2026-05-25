/**
 * Scheduled task catalogue \u2014 the eight background tasks Mr. Mwikila runs on
 * a schedule even when no human is logged in.
 *
 * Each task is a pure async function: (ctx) => TaskRunSummary. Task bodies
 * accept pluggable data sources so they stay testable with fakes. In
 * production the composition root binds real repositories via the `data`
 * factory; tests pass stub data.
 */

import type {
  ScheduledTaskDefinition,
  TaskRunContext,
  TaskRunSummary,
  TaskRunner,
} from './types.js';

/**
 * Result of dispatching a renewal proposal to the lease service.
 *
 * Returned by `proposeRenewal` so the generator can log the new
 * proposal ID + proposedRent in the insight's evidenceRefs. When the
 * port is not wired (degraded mode / tests), the generator falls back
 * to the insight-only path without crashing.
 */
export interface RenewalProposalDispatchResult {
  readonly proposalId: string;
  readonly proposedRent: number;
}

export interface RenewalProposalPort {
  /**
   * Push a renewal proposal into the lease service. Mirrors the HTTP
   * contract of `POST /renewals/:leaseId/propose`: the service decides
   * the final rent (via renewal optimizer) and returns the proposal
   * handle. Return `null` when the lease is already past its renewal
   * window / already has a pending proposal — the generator treats
   * null as "skip" rather than an error.
   */
  propose(input: {
    readonly tenantId: string;
    readonly leaseId: string;
    readonly currentRent: number;
    readonly daysToExpiry: number;
  }): Promise<RenewalProposalDispatchResult | null>;
}

export interface BackgroundTaskData {
  readonly listPropertiesForHealthScan: (
    tenantId: string,
  ) => Promise<readonly PortfolioProperty[]>;
  readonly listArrearsCases: (tenantId: string) => Promise<readonly ArrearsCase[]>;
  readonly listLeasesNearExpiry: (
    tenantId: string,
    windowDays: number,
  ) => Promise<readonly LeaseNearExpiry[]>;
  readonly listInspectionsDue: (
    tenantId: string,
  ) => Promise<readonly InspectionDue[]>;
  readonly listComplianceNotices: (
    tenantId: string,
  ) => Promise<readonly ComplianceNotice[]>;
  readonly summariseMonthlyCosts: (
    tenantId: string,
    asOf: Date,
  ) => Promise<MonthlyCostSummary | null>;
  readonly listVendorPerformance: (
    tenantId: string,
  ) => Promise<readonly VendorPerformance[]>;
  readonly recomputeTenantHealth: (
    tenantId: string,
  ) => Promise<readonly TenantHealth5Ps[]>;
  /**
   * Optional port that actually dispatches the renewal proposal into
   * the lease service. When present, `renewal_proposal_generator`
   * calls this and annotates the insight with the real proposal ID
   * instead of only writing a "draft pending review" note.
   */
  readonly renewalProposal?: RenewalProposalPort | null;
}

export interface PortfolioProperty {
  readonly id: string;
  readonly name: string;
  readonly occupancyRate: number;
  readonly openTickets: number;
  readonly lastInspectionDaysAgo: number;
}

export interface ArrearsCase {
  readonly id: string;
  readonly tenantName: string;
  readonly unitId: string;
  readonly daysOverdue: number;
  readonly balance: number;
  readonly ladderStep: number;
}

export interface LeaseNearExpiry {
  readonly leaseId: string;
  readonly tenantName: string;
  readonly unitId: string;
  readonly daysToExpiry: number;
  readonly rent: number;
}

export interface InspectionDue {
  readonly id: string;
  readonly propertyId: string;
  readonly daysOverdue: number;
  readonly type: 'FAR' | 'ROUTINE' | 'MOVE_IN' | 'MOVE_OUT';
}

export interface ComplianceNotice {
  readonly id: string;
  readonly kind: string;
  readonly expiresInDays: number;
}

export interface MonthlyCostSummary {
  readonly periodYearMonth: string;
  readonly grossCost: number;
  readonly topCategories: readonly { category: string; amount: number }[];
}

export interface VendorPerformance {
  readonly vendorId: string;
  readonly vendorName: string;
  readonly completedTickets: number;
  readonly avgResolutionHours: number;
  readonly satisfactionScore: number;
}

export interface TenantHealth5Ps {
  readonly tenantProfileId: string;
  readonly tenantName: string;
  readonly unitId: string;
  readonly payment: number;
  readonly property: number;
  readonly people: number;
  readonly paperwork: number;
  readonly presence: number;
}

const HIGH_OVERDUE_DAYS = 60;
const MEDIUM_OVERDUE_DAYS = 30;

export function buildTaskCatalogue(
  data: BackgroundTaskData,
): readonly ScheduledTaskDefinition[] {
  return [
    {
      name: 'portfolio_health_scan',
      cron: '0 2 * * *',
      description: 'Nightly scan of every property for anomalies',
      featureFlagKey: 'ai.bg.portfolio_health_scan',
      run: portfolioHealthScan(data),
    },
    {
      name: 'arrears_ladder_tick',
      cron: '30 2 * * *',
      description: 'Advance arrears cases through the escalation ladder',
      featureFlagKey: 'ai.bg.arrears_ladder_tick',
      run: arrearsLadderTick(data),
    },
    {
      name: 'renewal_proposal_generator',
      cron: '0 3 * * *',
      description: 'Auto-draft renewal proposals 90 days before expiry',
      featureFlagKey: 'ai.bg.renewal_proposal_generator',
      run: renewalProposalGenerator(data),
    },
    {
      name: 'far_inspection_reminder_sweep',
      cron: '30 3 * * *',
      description: 'Remind managers about due/overdue FAR inspections',
      featureFlagKey: 'ai.bg.far_inspection_reminder_sweep',
      run: farInspectionReminderSweep(data),
    },
    {
      name: 'compliance_expiry_check',
      cron: '0 4 * * *',
      description: 'Flag compliance notices about to expire',
      featureFlagKey: 'ai.bg.compliance_expiry_check',
      run: complianceExpiryCheck(data),
    },
    {
      name: 'cost_ledger_rollup',
      cron: '0 5 1 * *',
      description: 'Monthly cost-ledger rollup per tenant',
      featureFlagKey: 'ai.bg.cost_ledger_rollup',
      run: costLedgerRollup(data),
    },
    {
      name: 'vendor_performance_digest',
      cron: '0 6 * * 1',
      description: 'Weekly vendor performance digest',
      featureFlagKey: 'ai.bg.vendor_performance_digest',
      run: vendorPerformanceDigest(data),
    },
    {
      name: 'tenant_health_5ps_recompute',
      cron: '0 7 * * 1',
      description: 'Weekly tenant-health 5Ps recompute',
      featureFlagKey: 'ai.bg.tenant_health_5ps_recompute',
      run: tenantHealth5PsRecompute(data),
    },
  ] as const;
}

function wrap(
  task: string,
  body: (ctx: TaskRunContext) => Promise<number>,
): TaskRunner {
  return async (ctx: TaskRunContext): Promise<TaskRunSummary> => {
    const start = Date.now();
    let emitted = 0;
    try {
      emitted = await body(ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${task} failed: ${message}`);
    }
    return {
      task: task as TaskRunSummary['task'],
      tenantId: ctx.tenantId,
      insightsEmitted: emitted,
      durationMs: Date.now() - start,
      ranAt: ctx.now.toISOString(),
    };
  };
}

function portfolioHealthScan(data: BackgroundTaskData): TaskRunner {
  return wrap('portfolio_health_scan', async (ctx) => {
    const properties = await data.listPropertiesForHealthScan(ctx.tenantId);
    let emitted = 0;
    for (const p of properties) {
      if (p.occupancyRate < 0.7 || p.openTickets > 5) {
        await ctx.store.upsert({
          tenantId: ctx.tenantId,
          kind: 'portfolio_health',
          severity: p.occupancyRate < 0.5 ? 'high' : 'medium',
          title: `${p.name} needs attention`,
          description: `Occupancy ${Math.round(p.occupancyRate * 100)}%, ${p.openTickets} open tickets.`,
          evidenceRefs: [{ kind: 'property', id: p.id }],
          actionPlan: {
            summary: 'Review vacancy and maintenance queue',
            steps: [
              'Open property detail',
              'Check marketing status of vacant units',
              'Triage open tickets by severity',
            ],
          },
          dedupeKey: `portfolio_health:${p.id}`,
        });
        emitted++;
      }
    }
    return emitted;
  });
}

function arrearsLadderTick(data: BackgroundTaskData): TaskRunner {
  return wrap('arrears_ladder_tick', async (ctx) => {
    const cases = await data.listArrearsCases(ctx.tenantId);
    let emitted = 0;
    for (const c of cases) {
      const severity =
        c.daysOverdue >= HIGH_OVERDUE_DAYS
          ? 'high'
          : c.daysOverdue >= MEDIUM_OVERDUE_DAYS
            ? 'medium'
            : 'low';
      await ctx.store.upsert({
        tenantId: ctx.tenantId,
        kind: 'arrears_ladder',
        severity,
        title: `${c.tenantName} \u2014 unit ${c.unitId} is ${c.daysOverdue} days overdue`,
        description: `Balance ${c.balance.toLocaleString()} TZS; currently at ladder step ${c.ladderStep}.`,
        evidenceRefs: [{ kind: 'arrears_case', id: c.id }],
        actionPlan: {
          summary:
            c.daysOverdue >= HIGH_OVERDUE_DAYS
              ? 'Escalate to formal notice'
              : 'Send next arrears notice',
          steps: [
            'Open arrears case',
            'Confirm contact attempts log',
            'Send next notice',
          ],
        },
        dedupeKey: `arrears:${c.id}:step${c.ladderStep}`,
      });
      emitted++;
    }
    return emitted;
  });
}

function renewalProposalGenerator(data: BackgroundTaskData): TaskRunner {
  return wrap('renewal_proposal_generator', async (ctx) => {
    const leases = await data.listLeasesNearExpiry(ctx.tenantId, 90);
    let emitted = 0;
    for (const l of leases) {
      // Wave 18 — actually dispatch the proposal when the lease service
      // is wired. Absent port (tests / degraded mode) falls through to
      // the insight-only path so the head still sees the reminder.
      let dispatch: RenewalProposalDispatchResult | null = null;
      if (data.renewalProposal) {
        try {
          dispatch = await data.renewalProposal.propose({
            tenantId: ctx.tenantId,
            leaseId: l.leaseId,
            currentRent: l.rent,
            daysToExpiry: l.daysToExpiry,
          });
        } catch {
          // Swallow — the insight still fires so a human can follow up.
          dispatch = null;
        }
      }
      const rentPhrase = dispatch
        ? `Proposed new rent: ${dispatch.proposedRent.toLocaleString()} (proposal ${dispatch.proposalId}).`
        : 'Open draft proposal, adjust rent if needed, send to tenant via preferred channel.';
      const evidenceRefs: ReadonlyArray<{ kind: 'lease' | 'invoice'; id: string }> = dispatch
        ? [
            { kind: 'lease', id: l.leaseId },
            // Reuse the `invoice` evidence kind to link the dispatched
            // proposal id — the insight viewer renders the ref as a
            // clickable anchor either way.
            { kind: 'invoice', id: dispatch.proposalId },
          ]
        : [{ kind: 'lease', id: l.leaseId }];
      await ctx.store.upsert({
        tenantId: ctx.tenantId,
        kind: 'renewal_proposal',
        severity: l.daysToExpiry <= 30 ? 'high' : 'medium',
        title: dispatch
          ? `Renewal proposal submitted for ${l.tenantName}`
          : `Renewal proposal drafted for ${l.tenantName}`,
        description: `Lease for unit ${l.unitId} expires in ${l.daysToExpiry} days. Current rent ${l.rent.toLocaleString()} TZS. ${rentPhrase}`,
        evidenceRefs,
        actionPlan: {
          summary: dispatch
            ? 'Review the dispatched renewal proposal and confirm'
            : 'Review the auto-drafted renewal and send to tenant',
          steps: dispatch
            ? [
                'Open submitted proposal',
                'Confirm rent + term',
                'Track tenant response',
              ]
            : [
                'Open draft proposal',
                'Adjust rent if needed',
                'Send to tenant via preferred channel',
              ],
        },
        dedupeKey: `renewal:${l.leaseId}`,
      });
      emitted++;
    }
    return emitted;
  });
}

function farInspectionReminderSweep(data: BackgroundTaskData): TaskRunner {
  return wrap('far_inspection_reminder_sweep', async (ctx) => {
    const inspections = await data.listInspectionsDue(ctx.tenantId);
    let emitted = 0;
    for (const i of inspections) {
      await ctx.store.upsert({
        tenantId: ctx.tenantId,
        kind: 'far_inspection_reminder',
        severity: i.daysOverdue > 14 ? 'high' : 'medium',
        title: `${i.type} inspection due`,
        description: `Inspection for property ${i.propertyId} is ${i.daysOverdue} days overdue.`,
        evidenceRefs: [
          { kind: 'inspection', id: i.id },
          { kind: 'property', id: i.propertyId },
        ],
        actionPlan: {
          summary: 'Schedule the inspection',
          steps: ['Open inspection record', 'Assign inspector', 'Notify tenant'],
        },
        dedupeKey: `far:${i.id}`,
      });
      emitted++;
    }
    return emitted;
  });
}

function complianceExpiryCheck(data: BackgroundTaskData): TaskRunner {
  return wrap('compliance_expiry_check', async (ctx) => {
    const notices = await data.listComplianceNotices(ctx.tenantId);
    let emitted = 0;
    for (const n of notices) {
      if (n.expiresInDays > 60) continue;
      await ctx.store.upsert({
        tenantId: ctx.tenantId,
        kind: 'compliance_expiry',
        severity: n.expiresInDays <= 14 ? 'high' : 'medium',
        title: `${n.kind} expires in ${n.expiresInDays} days`,
        description: `Compliance notice ${n.kind} (id ${n.id}) is approaching expiry.`,
        evidenceRefs: [],
        actionPlan: {
          summary: 'Renew the notice before expiry',
          steps: ['Review current notice', 'Submit renewal paperwork'],
        },
        dedupeKey: `compliance:${n.id}`,
      });
      emitted++;
    }
    return emitted;
  });
}

function costLedgerRollup(data: BackgroundTaskData): TaskRunner {
  return wrap('cost_ledger_rollup', async (ctx) => {
    const summary = await data.summariseMonthlyCosts(ctx.tenantId, ctx.now);
    if (!summary) return 0;
    await ctx.store.upsert({
      tenantId: ctx.tenantId,
      kind: 'cost_ledger_rollup',
      severity: 'info',
      title: `Monthly cost rollup \u2014 ${summary.periodYearMonth}`,
      description: `Gross cost ${summary.grossCost.toLocaleString()} TZS. Top categories: ${summary.topCategories
        .map((c) => `${c.category} (${c.amount.toLocaleString()})`)
        .join(', ')}.`,
      evidenceRefs: [],
      actionPlan: {
        summary: 'Review the monthly cost report',
        steps: ['Open financials page', 'Export the report'],
      },
      dedupeKey: `cost_rollup:${summary.periodYearMonth}`,
    });
    return 1;
  });
}

function vendorPerformanceDigest(data: BackgroundTaskData): TaskRunner {
  return wrap('vendor_performance_digest', async (ctx) => {
    const vendors = await data.listVendorPerformance(ctx.tenantId);
    let emitted = 0;
    for (const v of vendors) {
      const underperforming = v.satisfactionScore < 0.7;
      if (!underperforming && v.completedTickets < 3) continue;
      await ctx.store.upsert({
        tenantId: ctx.tenantId,
        kind: 'vendor_performance',
        severity: underperforming ? 'medium' : 'info',
        title: `${v.vendorName} weekly performance`,
        description: `${v.completedTickets} tickets completed, avg resolution ${v.avgResolutionHours}h, CSAT ${Math.round(v.satisfactionScore * 100)}%.`,
        evidenceRefs: [],
        actionPlan: {
          summary: underperforming
            ? 'Review vendor and consider alternatives'
            : 'Acknowledge this vendor\u2019s performance',
          steps: ['Open vendor detail', 'Review recent tickets'],
        },
        dedupeKey: `vendor:${v.vendorId}:${weekKey(ctx.now)}`,
      });
      emitted++;
    }
    return emitted;
  });
}

function tenantHealth5PsRecompute(data: BackgroundTaskData): TaskRunner {
  return wrap('tenant_health_5ps_recompute', async (ctx) => {
    const tenants = await data.recomputeTenantHealth(ctx.tenantId);
    let emitted = 0;
    for (const t of tenants) {
      const weakest = Math.min(
        t.payment,
        t.property,
        t.people,
        t.paperwork,
        t.presence,
      );
      if (weakest >= 0.7) continue;
      await ctx.store.upsert({
        tenantId: ctx.tenantId,
        kind: 'tenant_health_5ps',
        severity: weakest < 0.4 ? 'high' : 'medium',
        title: `${t.tenantName} \u2014 tenant health signal`,
        description: `5Ps score: payment ${fmt(t.payment)}, property ${fmt(t.property)}, people ${fmt(t.people)}, paperwork ${fmt(t.paperwork)}, presence ${fmt(t.presence)}.`,
        evidenceRefs: [{ kind: 'lease', id: t.unitId }],
        actionPlan: {
          summary: 'Reach out with a tailored check-in',
          steps: ['Open tenant profile', 'Send a check-in message'],
        },
        dedupeKey: `tenant5ps:${t.tenantProfileId}:${weekKey(ctx.now)}`,
      });
      emitted++;
    }
    return emitted;
  });
}

function weekKey(now: Date): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const days = Math.floor(
    (now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000),
  );
  const week = Math.floor(days / 7);
  return `${now.getUTCFullYear()}W${week.toString().padStart(2, '0')}`;
}

function fmt(n: number): string {
  return Math.round(n * 100) + '%';
}
