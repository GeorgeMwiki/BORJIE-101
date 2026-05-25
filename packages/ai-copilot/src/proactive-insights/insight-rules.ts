/**
 * Declarative insight rules.
 *
 * Each rule is a tiny pure function from InsightContext \u2192 ProactiveInsight |
 * null. A fired insight is rendered as a gentle \"while you're here\u2026\" nudge
 * via the chat-ui proactive bubble.
 */

import type { InsightContext, InsightRule, ProactiveInsight } from './types.js';

function insight(
  id: string,
  category: ProactiveInsight extends { category: infer C } ? C : never,
  priority: ProactiveInsight['priority'],
  title: string,
  body: string,
  cta?: ProactiveInsight['cta'],
): ProactiveInsight {
  return {
    id,
    category: category as ProactiveInsight['category'] & typeof category,
    priority,
    title,
    body,
    cta,
  } as ProactiveInsight;
}

export const INSIGHT_RULES: readonly InsightRule[] = [
  {
    id: 'arrears_60_day_crossing',
    category: 'arrears_followup',
    description: 'Nudges manager on arrears case crossing day 60',
    evaluate(ctx: InsightContext): ProactiveInsight | null {
      if (!ctx.openArrearsCases || ctx.openArrearsCases < 1) return null;
      if (!ctx.currentPage.includes('arrears')) return null;
      return insight(
        'arrears_60_day_crossing',
        'arrears_followup',
        'high',
        'Day-60 arrears case',
        'A case in your current view just crossed day 60. Want me to draft the second notice?',
        { label: 'Draft notice', action: 'draft_arrears_notice' },
      );
    },
  },
  {
    id: 'renewal_window_90d',
    category: 'renewal_opportunity',
    description: 'Surfaces lease renewal drafts within 90 days',
    evaluate(ctx): ProactiveInsight | null {
      if (!ctx.leasesExpiring90 || ctx.leasesExpiring90 < 1) return null;
      return insight(
        'renewal_window_90d',
        'renewal_opportunity',
        'medium',
        'Leases nearing expiry',
        `${ctx.leasesExpiring90} lease${ctx.leasesExpiring90 === 1 ? '' : 's'} will expire within 90 days. I can draft proposals.`,
        { label: 'Review drafts', action: 'open_renewal_drafts' },
      );
    },
  },
  {
    id: 'maintenance_overdue_nudge',
    category: 'maintenance_escalation',
    description: 'Nudges on SLA-breaching tickets',
    evaluate(ctx): ProactiveInsight | null {
      if (!ctx.overdueTickets || ctx.overdueTickets < 1) return null;
      return insight(
        'maintenance_overdue_nudge',
        'maintenance_escalation',
        ctx.overdueTickets >= 5 ? 'high' : 'medium',
        'Overdue maintenance tickets',
        `${ctx.overdueTickets} ticket${ctx.overdueTickets === 1 ? '' : 's'} past SLA. Want me to rank and reassign?`,
        { label: 'Auto-triage', action: 'auto_triage_tickets' },
      );
    },
  },
  {
    id: 'compliance_expiry_nudge',
    category: 'compliance_reminder',
    description: 'Surfaces compliance notices about to lapse',
    evaluate(ctx): ProactiveInsight | null {
      if (!ctx.expiringCompliance || ctx.expiringCompliance < 1) return null;
      return insight(
        'compliance_expiry_nudge',
        'compliance_reminder',
        'high',
        'Compliance expiring',
        `${ctx.expiringCompliance} compliance notice${ctx.expiringCompliance === 1 ? '' : 's'} will expire soon. Let\u2019s renew.`,
        { label: 'Open notices', action: 'open_compliance' },
      );
    },
  },
  {
    id: 'inspection_followup',
    category: 'inspection_followup',
    description: 'Reminds to capture inspection notes',
    evaluate(ctx): ProactiveInsight | null {
      if (!ctx.currentPage.includes('inspection')) return null;
      return insight(
        'inspection_followup',
        'inspection_followup',
        'medium',
        'Inspection follow-up',
        'I can summarise today\u2019s inspection into a one-page report.',
        { label: 'Summarise', action: 'summarise_inspection' },
      );
    },
  },
  {
    id: 'vendor_swap_suggestion',
    category: 'vendor_swap',
    description: 'Suggests swapping an underperforming vendor',
    evaluate(ctx): ProactiveInsight | null {
      if (!ctx.currentPage.includes('maintenance')) return null;
      if (!ctx.overdueTickets || ctx.overdueTickets < 3) return null;
      return insight(
        'vendor_swap_suggestion',
        'vendor_swap',
        'medium',
        'Vendor performance',
        'The current vendor has a cluster of overdue tickets. I can shortlist alternates.',
        { label: 'Shortlist', action: 'shortlist_vendors' },
      );
    },
  },
  {
    id: 'tenant_satisfaction_checkin',
    category: 'tenant_satisfaction',
    description: 'Suggests a check-in after recent maintenance',
    evaluate(ctx): ProactiveInsight | null {
      if (!ctx.currentPage.includes('tenant')) return null;
      return insight(
        'tenant_satisfaction_checkin',
        'tenant_satisfaction',
        'low',
        'Check-in message',
        'Want me to draft a short check-in message for this tenant?',
        { label: 'Draft', action: 'draft_checkin' },
      );
    },
  },
  {
    id: 'workflow_unblock',
    category: 'workflow_unblock',
    description: 'Fires when the user appears stalled',
    evaluate(ctx): ProactiveInsight | null {
      if (!ctx.lastStallAt) return null;
      const age = Date.now() - new Date(ctx.lastStallAt).getTime();
      if (age > 120_000) return null;
      return insight(
        'workflow_unblock',
        'workflow_unblock',
        'medium',
        'Stuck?',
        'I noticed you paused here. Want me to walk you through the remaining steps?',
        { label: 'Walk me through', action: 'walk_through' },
      );
    },
  },
  {
    id: 'arrears_ladder_tomorrow',
    category: 'arrears_followup',
    description: 'Alerts when ladder moves tomorrow',
    evaluate(ctx): ProactiveInsight | null {
      if (!ctx.currentPage.includes('arrears')) return null;
      if (!ctx.openArrearsCases) return null;
      return insight(
        'arrears_ladder_tomorrow',
        'arrears_followup',
        'low',
        'Ladder advance tomorrow',
        'Some cases will advance on the arrears ladder tomorrow \u2014 want me to preview?',
        { label: 'Preview advances', action: 'preview_ladder' },
      );
    },
  },
  {
    id: 'bulk_tenant_outreach',
    category: 'tenant_satisfaction',
    description: 'Suggests bulk outreach on the tenant list page',
    evaluate(ctx): ProactiveInsight | null {
      if (!ctx.currentPage.endsWith('tenants')) return null;
      return insight(
        'bulk_tenant_outreach',
        'tenant_satisfaction',
        'low',
        'Bulk outreach',
        'I can draft a one-click monthly check-in to every tenant on this list.',
        { label: 'Draft outreach', action: 'draft_bulk_outreach' },
      );
    },
  },
  {
    id: 'financial_variance_walkthrough',
    category: 'workflow_unblock',
    description: 'Offers a walkthrough of unusual financial variance',
    evaluate(ctx): ProactiveInsight | null {
      if (!ctx.currentPage.includes('financial')) return null;
      return insight(
        'financial_variance_walkthrough',
        'workflow_unblock',
        'low',
        'Variance explainer',
        'Any figure on this page look off? I can explain the variance line-by-line.',
        { label: 'Explain variance', action: 'explain_variance' },
      );
    },
  },
  {
    id: 'renewal_pricing_sanity',
    category: 'renewal_opportunity',
    description: 'Flags renewal proposal pricing out of band',
    evaluate(ctx): ProactiveInsight | null {
      if (!ctx.currentPage.includes('renewal')) return null;
      return insight(
        'renewal_pricing_sanity',
        'renewal_opportunity',
        'medium',
        'Renewal pricing check',
        'I can compare this renewal\u2019s pricing against market comparables for your district.',
        { label: 'Compare', action: 'compare_market' },
      );
    },
  },
];
