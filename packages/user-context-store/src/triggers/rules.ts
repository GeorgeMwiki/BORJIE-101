/**
 * Trigger rule registry.
 *
 * PURE — every rule's `evaluate` takes the in-memory profile + signals
 * bundle and returns either a fully-populated {@link Trigger} or null.
 * No DB, no IO. The engine in `engine.ts` runs every applicable rule
 * and sorts the survivors by urgency.
 *
 * Trigger ids are deterministic: `sha256(userId|kind|dateBucket)`,
 * formatted as `bn_<10-hex>`. The dateBucket is YYYY-MM-DD by default
 * so the same condition only fires one notification per day.
 */
import { createHash } from 'crypto';
import type {
  AnyProfile,
  BehavioralSignals,
  OwnerProfile,
  PMProfile,
  ProspectProfile,
  Role,
  TenantProfile,
  Trigger,
  AdminProfile,
} from '../types.js';

export interface RuleEvalArgs {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: Role;
  readonly profile: AnyProfile;
  readonly signals: BehavioralSignals;
  readonly now?: Date;
}

export interface TriggerRule {
  readonly id: string;
  readonly kind: string;
  readonly applicableRoles: ReadonlyArray<Role>;
  evaluate(args: RuleEvalArgs): Trigger | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Stable, deterministic id for a trigger occurrence. Same user + same
 * kind + same day → same id, which the worker uses as the idempotency
 * key.
 */
export function triggerKey(userId: string, kind: string, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  const h = createHash('sha256').update(`${userId}|${kind}|${day}`).digest('hex');
  return `bn_${h.slice(0, 10)}`;
}

function isTenant(p: AnyProfile): p is TenantProfile {
  // TenantProfile is the "default" tenant-shaped dossier. We treat
  // anything that ISN'T clearly another role's shape as tenant — the
  // caller already passed `role: 'tenant'` so the engine filters first.
  const owner = (p as Partial<OwnerProfile>).properties;
  const pm = (p as Partial<PMProfile>).managedProperties;
  const prospect = (p as Partial<ProspectProfile>).savedListings ?? (p as Partial<ProspectProfile>).leadQuality;
  return !Array.isArray(owner) && !Array.isArray(pm) && prospect === undefined;
}
function isOwner(p: AnyProfile): p is OwnerProfile {
  return Array.isArray((p as Partial<OwnerProfile>).properties);
}
function isPM(p: AnyProfile): p is PMProfile {
  return Array.isArray((p as Partial<PMProfile>).managedProperties);
}
function isAdmin(p: AnyProfile): p is AdminProfile {
  // Admin profiles always have identity, may have totals or billing.
  // Fall back to "not clearly any other role" since admin fields are
  // all optional.
  const owner = (p as Partial<OwnerProfile>).properties;
  const pm = (p as Partial<PMProfile>).managedProperties;
  const prospect = (p as Partial<ProspectProfile>).savedListings ?? (p as Partial<ProspectProfile>).leadQuality;
  const tenantFlag = (p as Partial<TenantProfile>).currentLease ?? (p as Partial<TenantProfile>).paymentHistory24m;
  return (
    !Array.isArray(owner) &&
    !Array.isArray(pm) &&
    prospect === undefined &&
    tenantFlag === undefined
  );
}
function isProspect(p: AnyProfile): p is ProspectProfile {
  return (
    (p as Partial<ProspectProfile>).savedListings !== undefined ||
    (p as Partial<ProspectProfile>).leadQuality !== undefined ||
    (p as Partial<ProspectProfile>).propertiesViewed !== undefined ||
    (p as Partial<ProspectProfile>).searches !== undefined
  );
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

function makeTrigger(
  args: RuleEvalArgs,
  rule: { kind: string; urgency: 1 | 2 | 3 | 4 | 5 },
  body: {
    summary: string;
    suggestedAction: string;
    suggestedPromptForChat: string;
    triggeringEvidence: ReadonlyArray<{ kind: string; id: string; field?: string }>;
  },
): Trigger {
  const now = args.now ?? new Date();
  return {
    id: triggerKey(args.userId, rule.kind, now),
    kind: rule.kind,
    urgency: rule.urgency,
    summary: body.summary,
    suggestedAction: body.suggestedAction,
    suggestedPromptForChat: body.suggestedPromptForChat,
    triggeringEvidence: body.triggeringEvidence,
  };
}

// ---------------------------------------------------------------------------
// Tenant rules
// ---------------------------------------------------------------------------

const tenantRules: ReadonlyArray<TriggerRule> = [
  {
    id: 'tenant.lease_ending_90d',
    kind: 'tenant.lease_ending_90d',
    applicableRoles: ['tenant'],
    evaluate(args) {
      if (!isTenant(args.profile)) return null;
      const lease = args.profile.currentLease;
      if (!lease?.endDate) return null;
      const now = args.now ?? new Date();
      const days = daysBetween(now, new Date(lease.endDate));
      if (days <= 90 && days > 60) {
        return makeTrigger(
          args,
          { kind: 'tenant.lease_ending_90d', urgency: 2 },
          {
            summary: `Your lease ends in ${days} days. Renewal window now open.`,
            suggestedAction: 'Review renewal terms and indicate your intent.',
            suggestedPromptForChat:
              'My lease ends in 90 days. Walk me through renewal options.',
            triggeringEvidence: [{ kind: 'lease', id: lease.leaseId, field: 'end_date' }],
          },
        );
      }
      return null;
    },
  },
  {
    id: 'tenant.lease_ending_60d',
    kind: 'tenant.lease_ending_60d',
    applicableRoles: ['tenant'],
    evaluate(args) {
      if (!isTenant(args.profile)) return null;
      const lease = args.profile.currentLease;
      if (!lease?.endDate) return null;
      const now = args.now ?? new Date();
      const days = daysBetween(now, new Date(lease.endDate));
      if (days <= 60 && days > 30) {
        return makeTrigger(
          args,
          { kind: 'tenant.lease_ending_60d', urgency: 3 },
          {
            summary: `Your lease ends in ${days} days. Decide on renewal soon.`,
            suggestedAction: 'Confirm renewal or give notice within the next 30 days.',
            suggestedPromptForChat:
              'What are my options for renewing or ending my lease at term?',
            triggeringEvidence: [{ kind: 'lease', id: lease.leaseId, field: 'end_date' }],
          },
        );
      }
      return null;
    },
  },
  {
    id: 'tenant.lease_ending_30d',
    kind: 'tenant.lease_ending_30d',
    applicableRoles: ['tenant'],
    evaluate(args) {
      if (!isTenant(args.profile)) return null;
      const lease = args.profile.currentLease;
      if (!lease?.endDate) return null;
      const now = args.now ?? new Date();
      const days = daysBetween(now, new Date(lease.endDate));
      if (days <= 30 && days >= 0) {
        return makeTrigger(
          args,
          { kind: 'tenant.lease_ending_30d', urgency: 5 },
          {
            summary: `URGENT: Your lease ends in ${days} days.`,
            suggestedAction: 'Sign renewal documents or give written notice today.',
            suggestedPromptForChat:
              'My lease ends in less than 30 days. What do I need to do right now?',
            triggeringEvidence: [{ kind: 'lease', id: lease.leaseId, field: 'end_date' }],
          },
        );
      }
      return null;
    },
  },
  {
    id: 'tenant.payment_late_7d',
    kind: 'tenant.payment_late_7d',
    applicableRoles: ['tenant'],
    evaluate(args) {
      if (!isTenant(args.profile)) return null;
      const months = args.profile.paymentHistory24m ?? [];
      const latest = months[0];
      if (!latest) return null;
      const daysLate = latest.daysLate ?? 0;
      if (daysLate >= 7 && daysLate < 14 && latest.balance > 0) {
        return makeTrigger(
          args,
          { kind: 'tenant.payment_late_7d', urgency: 3 },
          {
            summary: `Rent payment is ${daysLate} days late.`,
            suggestedAction: 'Pay outstanding balance to avoid late fees.',
            suggestedPromptForChat:
              'Can you show me my current balance and suggest a payment plan?',
            triggeringEvidence: [{ kind: 'payment', id: latest.month, field: 'balance' }],
          },
        );
      }
      return null;
    },
  },
  {
    id: 'tenant.payment_late_14d',
    kind: 'tenant.payment_late_14d',
    applicableRoles: ['tenant'],
    evaluate(args) {
      if (!isTenant(args.profile)) return null;
      const months = args.profile.paymentHistory24m ?? [];
      const latest = months[0];
      if (!latest) return null;
      const daysLate = latest.daysLate ?? 0;
      if (daysLate >= 14 && latest.balance > 0) {
        return makeTrigger(
          args,
          { kind: 'tenant.payment_late_14d', urgency: 5 },
          {
            summary: `URGENT: Rent ${daysLate} days late. Late fees and eviction risk active.`,
            suggestedAction: 'Pay now or contact property manager to negotiate a plan.',
            suggestedPromptForChat:
              'I am behind on rent. What are my options to catch up or set up a plan?',
            triggeringEvidence: [{ kind: 'payment', id: latest.month, field: 'balance' }],
          },
        );
      }
      return null;
    },
  },
  {
    id: 'tenant.repeat_maintenance_same_category_90d',
    kind: 'tenant.repeat_maintenance_same_category_90d',
    applicableRoles: ['tenant'],
    evaluate(args) {
      if (!isTenant(args.profile)) return null;
      const closed = args.profile.closedMaintenance12m ?? [];
      const open = args.profile.openMaintenance ?? [];
      const all = [...closed, ...open];
      const now = args.now ?? new Date();
      const last90 = all.filter(
        (m) => now.getTime() - Date.parse(m.submittedAt) <= 1000 * 60 * 60 * 24 * 90,
      );
      const byCat = new Map<string, number>();
      for (const m of last90) byCat.set(m.category, (byCat.get(m.category) ?? 0) + 1);
      for (const [cat, count] of byCat) {
        if (count >= 3) {
          return makeTrigger(
            args,
            { kind: 'tenant.repeat_maintenance_same_category_90d', urgency: 4 },
            {
              summary: `${count} ${cat} requests in 90 days suggest a recurring issue.`,
              suggestedAction:
                'Request a root-cause inspection rather than another patch.',
              suggestedPromptForChat: `I have had ${count} ${cat} requests recently. Can you escalate this to a root-cause fix?`,
              triggeringEvidence: last90
                .filter((m) => m.category === cat)
                .slice(0, 5)
                .map((m) => ({ kind: 'maintenance' as const, id: m.workOrderId })),
            },
          );
        }
      }
      return null;
    },
  },
  {
    id: 'tenant.energy_bill_up_yoy',
    kind: 'tenant.energy_bill_up_yoy',
    applicableRoles: ['tenant'],
    evaluate(args) {
      if (!isTenant(args.profile)) return null;
      // We don't carry per-month energy on the dossier today; surface only
      // if EUI signal is markedly higher than property average.
      const property = args.profile.property;
      if (!property?.euiKwhPerSqmYr) return null;
      if (property.euiKwhPerSqmYr <= 200) return null;
      return makeTrigger(
        args,
        { kind: 'tenant.energy_bill_up_yoy', urgency: 2 },
        {
          summary: `Your building's energy intensity (${property.euiKwhPerSqmYr} kWh/m²/yr) is above benchmark.`,
          suggestedAction: 'Review power-saving tips and request HVAC tune-up.',
          suggestedPromptForChat:
            'My energy bill is high. What can I do to reduce it?',
          triggeringEvidence: [{ kind: 'property', id: property.propertyId, field: 'eui' }],
        },
      );
    },
  },
  {
    id: 'tenant.unresolved_escalation_7d',
    kind: 'tenant.unresolved_escalation_7d',
    applicableRoles: ['tenant'],
    evaluate(args) {
      if (!isTenant(args.profile)) return null;
      const open = args.profile.openMaintenance ?? [];
      const now = args.now ?? new Date();
      const stuck = open.filter(
        (m) =>
          (m.priority === 'high' || m.priority === 'urgent' || m.priority === 'emergency') &&
          now.getTime() - Date.parse(m.submittedAt) >= 1000 * 60 * 60 * 24 * 7,
      );
      if (stuck.length > 0) {
        const first = stuck[0]!;
        return makeTrigger(
          args,
          { kind: 'tenant.unresolved_escalation_7d', urgency: 5 },
          {
            summary: `High-priority issue open ${daysBetween(new Date(first.submittedAt), now)} days.`,
            suggestedAction: 'Escalate to property manager and request status.',
            suggestedPromptForChat:
              'Please escalate my urgent maintenance request and tell me when it will be resolved.',
            triggeringEvidence: stuck
              .slice(0, 3)
              .map((m) => ({ kind: 'maintenance' as const, id: m.workOrderId })),
          },
        );
      }
      return null;
    },
  },
  {
    id: 'tenant.document_expiring_30d',
    kind: 'tenant.document_expiring_30d',
    applicableRoles: ['tenant'],
    evaluate(args) {
      const expiring = args.signals.openItems.expiringDocuments;
      if (expiring.length === 0) return null;
      const first = expiring[0]!;
      return makeTrigger(
        args,
        { kind: 'tenant.document_expiring_30d', urgency: 3 },
        {
          summary: `${expiring.length} document(s) expire within 30 days.`,
          suggestedAction: 'Upload renewed copy to avoid service interruption.',
          suggestedPromptForChat:
            'Which of my documents are expiring soon and how do I update them?',
          triggeringEvidence: [{ kind: 'document', id: first.kind, field: 'expires_at' }],
        },
      );
    },
  },
  {
    id: 'tenant.household_change_recorded',
    kind: 'tenant.household_change_recorded',
    applicableRoles: ['tenant'],
    evaluate(args) {
      if (!isTenant(args.profile)) return null;
      const h = args.profile.household;
      const lease = args.profile.currentLease;
      if (!h || !lease) return null;
      const total = h.adults + h.children;
      // Heuristic: if recorded occupants now exceed lease max (proxy = 4), flag.
      if (total > 4) {
        return makeTrigger(
          args,
          { kind: 'tenant.household_change_recorded', urgency: 2 },
          {
            summary: `Household size (${total}) may exceed lease limits.`,
            suggestedAction: 'Notify property manager to update lease addenda.',
            suggestedPromptForChat:
              'I have additional household members — what do I need to update on the lease?',
            triggeringEvidence: [{ kind: 'lease', id: lease.leaseId, field: 'occupants' }],
          },
        );
      }
      return null;
    },
  },
  {
    id: 'tenant.neighborhood_event_nearby',
    kind: 'tenant.neighborhood_event_nearby',
    applicableRoles: ['tenant'],
    evaluate(args) {
      // Without an events table on the profile yet, fire only when the
      // signal explicitly bubbles up via intentSignals (search.active +
      // neighborhood kind).
      if (!isTenant(args.profile)) return null;
      const intent = args.signals.intentSignals.find(
        (i) => i.kind === 'neighborhood.event_nearby',
      );
      if (!intent) return null;
      return makeTrigger(
        args,
        { kind: 'tenant.neighborhood_event_nearby', urgency: 1 },
        {
          summary: 'Local event nearby may affect parking or noise.',
          suggestedAction: 'Plan ahead — check building notices.',
          suggestedPromptForChat: 'Are there any local events I should know about?',
          triggeringEvidence: [{ kind: 'signal', id: 'neighborhood' }],
        },
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Owner rules
// ---------------------------------------------------------------------------

const ownerRules: ReadonlyArray<TriggerRule> = [
  {
    id: 'owner.unit_vacant_45d',
    kind: 'owner.unit_vacant_45d',
    applicableRoles: ['owner'],
    evaluate(args) {
      if (!isOwner(args.profile)) return null;
      // Use occupancy < 95% per property as proxy for vacancies aging.
      const aging = args.profile.properties.filter(
        (p) => (p.occupancyPct ?? 100) < 95,
      );
      if (aging.length === 0) return null;
      const first = aging[0]!;
      return makeTrigger(
        args,
        { kind: 'owner.unit_vacant_45d', urgency: 3 },
        {
          summary: `${aging.length} property/properties show vacancies (occupancy ${first.occupancyPct?.toFixed(1)}%).`,
          suggestedAction: 'Review listing strategy and tour metrics.',
          suggestedPromptForChat:
            'Which units have been vacant longest, and what is the marketing plan?',
          triggeringEvidence: aging
            .slice(0, 3)
            .map((p) => ({ kind: 'property' as const, id: p.propertyId, field: 'occupancy' })),
        },
      );
    },
  },
  {
    id: 'owner.noi_down_10pct',
    kind: 'owner.noi_down_10pct',
    applicableRoles: ['owner'],
    evaluate(args) {
      if (!isOwner(args.profile)) return null;
      // Without prior-period NOI on the dossier, infer "down" from
      // properties with NOI < typical (heuristic placeholder).
      const total = args.profile.totalPortfolioNoi ?? 0;
      if (total === 0) return null;
      const intent = args.signals.intentSignals.find(
        (i) => i.kind === 'finance.noi_down',
      );
      if (!intent) return null;
      return makeTrigger(
        args,
        { kind: 'owner.noi_down_10pct', urgency: 4 },
        {
          summary: 'Portfolio NOI is materially down vs prior period.',
          suggestedAction: 'Review expense drivers and rent collection.',
          suggestedPromptForChat: 'Why is my NOI down this period, and how can I close the gap?',
          triggeringEvidence: [{ kind: 'signal', id: 'noi_down' }],
        },
      );
    },
  },
  {
    id: 'owner.mortgage_payment_due',
    kind: 'owner.mortgage_payment_due',
    applicableRoles: ['owner'],
    evaluate(args) {
      if (!isOwner(args.profile)) return null;
      const withMortgage = args.profile.properties.filter(
        (p) => (p.mortgageOutstanding ?? 0) > 0,
      );
      if (withMortgage.length === 0) return null;
      return makeTrigger(
        args,
        { kind: 'owner.mortgage_payment_due', urgency: 3 },
        {
          summary: `${withMortgage.length} property/properties have an active mortgage; verify cash flow covers next payment.`,
          suggestedAction: 'Confirm rent collection vs mortgage due dates.',
          suggestedPromptForChat: 'Will my rental income cover this month\'s mortgage payments?',
          triggeringEvidence: withMortgage
            .slice(0, 3)
            .map((p) => ({ kind: 'property' as const, id: p.propertyId, field: 'mortgage' })),
        },
      );
    },
  },
  {
    id: 'owner.insurance_expiring_60d',
    kind: 'owner.insurance_expiring_60d',
    applicableRoles: ['owner'],
    evaluate(args) {
      if (!isOwner(args.profile)) return null;
      const now = args.now ?? new Date();
      const soon = args.profile.properties.filter((p) => {
        if (!p.insuranceExpiresAt) return false;
        const d = daysBetween(now, new Date(p.insuranceExpiresAt));
        return d >= 0 && d <= 60;
      });
      if (soon.length === 0) return null;
      return makeTrigger(
        args,
        { kind: 'owner.insurance_expiring_60d', urgency: 4 },
        {
          summary: `Insurance on ${soon.length} property/properties expires within 60 days.`,
          suggestedAction: 'Renew policies to avoid coverage gap.',
          suggestedPromptForChat: 'Which property insurance policies expire soon, and what should I renew?',
          triggeringEvidence: soon
            .slice(0, 3)
            .map((p) => ({ kind: 'property' as const, id: p.propertyId, field: 'insurance_expires_at' })),
        },
      );
    },
  },
  {
    id: 'owner.capex_line_flagged',
    kind: 'owner.capex_line_flagged',
    applicableRoles: ['owner'],
    evaluate(args) {
      if (!isOwner(args.profile)) return null;
      const flagged = args.profile.properties.filter(
        (p) => (p.capex12mTotal ?? 0) > 0,
      );
      if (flagged.length === 0) return null;
      const total = flagged.reduce((s, p) => s + (p.capex12mTotal ?? 0), 0);
      return makeTrigger(
        args,
        { kind: 'owner.capex_line_flagged', urgency: 2 },
        {
          summary: `Capex commitments of ${total} (minor units) in the next 12 months.`,
          suggestedAction: 'Confirm reserve fund covers planned work.',
          suggestedPromptForChat: 'What capex is coming up and what should I prioritize?',
          triggeringEvidence: flagged
            .slice(0, 3)
            .map((p) => ({ kind: 'property' as const, id: p.propertyId, field: 'capex' })),
        },
      );
    },
  },
  {
    id: 'owner.tax_filing_window',
    kind: 'owner.tax_filing_window',
    applicableRoles: ['owner'],
    evaluate(args) {
      if (!isOwner(args.profile)) return null;
      const intent = args.signals.intentSignals.find(
        (i) => i.kind === 'tax.filing_window',
      );
      if (!intent) return null;
      return makeTrigger(
        args,
        { kind: 'owner.tax_filing_window', urgency: 2 },
        {
          summary: 'Tax filing window is open for rental income.',
          suggestedAction: 'Export annual statement and lodge with revenue authority.',
          suggestedPromptForChat: 'Help me prepare my rental income tax filing.',
          triggeringEvidence: [{ kind: 'signal', id: 'tax_window' }],
        },
      );
    },
  },
  {
    id: 'owner.occupancy_below_90pct',
    kind: 'owner.occupancy_below_90pct',
    applicableRoles: ['owner'],
    evaluate(args) {
      if (!isOwner(args.profile)) return null;
      if (args.profile.properties.length === 0) return null;
      const avg =
        args.profile.properties.reduce(
          (s, p) => s + (p.occupancyPct ?? 0),
          0,
        ) / args.profile.properties.length;
      if (avg < 90) {
        return makeTrigger(
          args,
          { kind: 'owner.occupancy_below_90pct', urgency: 4 },
          {
            summary: `Portfolio occupancy ${avg.toFixed(1)}% — below 90% target.`,
            suggestedAction: 'Push leasing efforts on vacant units.',
            suggestedPromptForChat: 'How can I get occupancy back above 90%?',
            triggeringEvidence: args.profile.properties
              .slice(0, 5)
              .map((p) => ({ kind: 'property' as const, id: p.propertyId, field: 'occupancy' })),
          },
        );
      }
      return null;
    },
  },
  {
    id: 'owner.churn_spike',
    kind: 'owner.churn_spike',
    applicableRoles: ['owner'],
    evaluate(args) {
      if (!isOwner(args.profile)) return null;
      const churning = args.profile.properties.filter(
        (p) => (p.tenantChurnPct ?? 0) >= 15,
      );
      if (churning.length === 0) return null;
      return makeTrigger(
        args,
        { kind: 'owner.churn_spike', urgency: 4 },
        {
          summary: `Tenant churn spiked on ${churning.length} property/properties.`,
          suggestedAction: 'Investigate move-out reasons and retention drivers.',
          suggestedPromptForChat: 'Why are tenants leaving and what can I do to retain them?',
          triggeringEvidence: churning
            .slice(0, 3)
            .map((p) => ({ kind: 'property' as const, id: p.propertyId, field: 'churn' })),
        },
      );
    },
  },
  {
    id: 'owner.refinancing_window_opens',
    kind: 'owner.refinancing_window_opens',
    applicableRoles: ['owner'],
    evaluate(args) {
      if (!isOwner(args.profile)) return null;
      const intent = args.signals.intentSignals.find(
        (i) => i.kind === 'finance.refi_window',
      );
      if (!intent) return null;
      return makeTrigger(
        args,
        { kind: 'owner.refinancing_window_opens', urgency: 2 },
        {
          summary: 'Refinancing window opening based on rate environment.',
          suggestedAction: 'Compare refi terms against current mortgage.',
          suggestedPromptForChat: 'Should I refinance any of my mortgages now?',
          triggeringEvidence: [{ kind: 'signal', id: 'refi_window' }],
        },
      );
    },
  },
];

// ---------------------------------------------------------------------------
// PM rules
// ---------------------------------------------------------------------------

const pmRules: ReadonlyArray<TriggerRule> = [
  {
    id: 'pm.sla_missed_last_week',
    kind: 'pm.sla_missed_last_week',
    applicableRoles: ['pm'],
    evaluate(args) {
      if (!isPM(args.profile)) return null;
      const breaches = args.profile.kpis?.slaBreachesLast30d ?? 0;
      if (breaches >= 1) {
        return makeTrigger(
          args,
          { kind: 'pm.sla_missed_last_week', urgency: 4 },
          {
            summary: `${breaches} SLA breach(es) in the last 30 days.`,
            suggestedAction: 'Review breached work orders and root-cause delays.',
            suggestedPromptForChat: 'Which SLAs were missed last week and why?',
            triggeringEvidence: [{ kind: 'signal', id: 'sla_breaches' }],
          },
        );
      }
      return null;
    },
  },
  {
    id: 'pm.escalation_backlog_5plus',
    kind: 'pm.escalation_backlog_5plus',
    applicableRoles: ['pm'],
    evaluate(args) {
      if (!isPM(args.profile)) return null;
      const escalations = args.profile.kpis?.escalationsLast30d ?? 0;
      if (escalations >= 5) {
        return makeTrigger(
          args,
          { kind: 'pm.escalation_backlog_5plus', urgency: 4 },
          {
            summary: `${escalations} escalations open in last 30 days.`,
            suggestedAction: 'Triage backlog and assign owners.',
            suggestedPromptForChat: 'Walk me through my escalation backlog by priority.',
            triggeringEvidence: [{ kind: 'signal', id: 'escalations' }],
          },
        );
      }
      return null;
    },
  },
  {
    id: 'pm.vendor_sla_breach',
    kind: 'pm.vendor_sla_breach',
    applicableRoles: ['pm'],
    evaluate(args) {
      if (!isPM(args.profile)) return null;
      const vendors = args.profile.vendors ?? [];
      const probation = vendors.filter(
        (v) => v.status === 'probation' || v.status === 'suspended',
      );
      if (probation.length === 0) return null;
      return makeTrigger(
        args,
        { kind: 'pm.vendor_sla_breach', urgency: 3 },
        {
          summary: `${probation.length} vendor(s) on probation/suspended.`,
          suggestedAction: 'Decide on reinstate / replace and update routing.',
          suggestedPromptForChat: 'Which vendors are underperforming and what should I do?',
          triggeringEvidence: probation
            .slice(0, 3)
            .map((v) => ({ kind: 'signal' as const, id: v.vendorId })),
        },
      );
    },
  },
  {
    id: 'pm.staff_workload_imbalance',
    kind: 'pm.staff_workload_imbalance',
    applicableRoles: ['pm'],
    evaluate(args) {
      if (!isPM(args.profile)) return null;
      const staff = args.profile.staffUnderMgmt ?? [];
      if (staff.length < 2) return null;
      // We don't have per-staff loads here; surface only when intent
      // signal is explicit.
      const intent = args.signals.intentSignals.find(
        (i) => i.kind === 'workload.imbalance',
      );
      if (!intent) return null;
      return makeTrigger(
        args,
        { kind: 'pm.staff_workload_imbalance', urgency: 2 },
        {
          summary: 'Workload distribution looks uneven across your team.',
          suggestedAction: 'Rebalance assignments or reroute high-volume queues.',
          suggestedPromptForChat: 'How is workload split across my team and where can I rebalance?',
          triggeringEvidence: [{ kind: 'signal', id: 'workload_imbalance' }],
        },
      );
    },
  },
  {
    id: 'pm.kpi_target_miss',
    kind: 'pm.kpi_target_miss',
    applicableRoles: ['pm'],
    evaluate(args) {
      if (!isPM(args.profile)) return null;
      const kpis = args.profile.kpis;
      if (!kpis) return null;
      if (
        (kpis.occupancyPct !== undefined && kpis.occupancyPct < 90) ||
        (kpis.avgResponseTimeMinutes !== undefined && kpis.avgResponseTimeMinutes > 60)
      ) {
        return makeTrigger(
          args,
          { kind: 'pm.kpi_target_miss', urgency: 3 },
          {
            summary: 'Key KPI(s) under target this period.',
            suggestedAction: 'Drill into responsible properties and intervene.',
            suggestedPromptForChat: 'Which of my KPIs are under target and what is driving the miss?',
            triggeringEvidence: [{ kind: 'signal', id: 'kpi_miss' }],
          },
        );
      }
      return null;
    },
  },
];

// ---------------------------------------------------------------------------
// Admin rules
// ---------------------------------------------------------------------------

const adminRules: ReadonlyArray<TriggerRule> = [
  {
    id: 'admin.billing_tier_near_limit',
    kind: 'admin.billing_tier_near_limit',
    applicableRoles: ['admin'],
    evaluate(args) {
      if (!isAdmin(args.profile)) return null;
      // Heuristic: starter tier with >=80 users → near limit.
      if (
        args.profile.billingPosition?.tier === 'starter' &&
        (args.profile.totalUsers ?? 0) >= 80
      ) {
        return makeTrigger(
          args,
          { kind: 'admin.billing_tier_near_limit', urgency: 3 },
          {
            summary: 'Approaching seat limit on your current plan.',
            suggestedAction: 'Review usage and consider upgrading to avoid disruption.',
            suggestedPromptForChat: 'Should I upgrade my plan based on current usage?',
            triggeringEvidence: [{ kind: 'signal', id: 'plan_usage' }],
          },
        );
      }
      return null;
    },
  },
  {
    id: 'admin.feature_usage_anomaly',
    kind: 'admin.feature_usage_anomaly',
    applicableRoles: ['admin'],
    evaluate(args) {
      if (!isAdmin(args.profile)) return null;
      const usage = args.profile.featureUsage30d ?? {};
      const anomalous = Object.entries(usage).find(([, v]) => v < 1);
      if (!anomalous) return null;
      return makeTrigger(
        args,
        { kind: 'admin.feature_usage_anomaly', urgency: 2 },
        {
          summary: `Feature ${anomalous[0]} barely used in the last 30 days.`,
          suggestedAction: 'Check rollout, training, or enablement gap.',
          suggestedPromptForChat: 'Why is feature usage dropping and what can I do?',
          triggeringEvidence: [{ kind: 'signal', id: 'feature_usage' }],
        },
      );
    },
  },
  {
    id: 'admin.high_severity_risk_flag',
    kind: 'admin.high_severity_risk_flag',
    applicableRoles: ['admin'],
    evaluate(args) {
      if (!isAdmin(args.profile)) return null;
      const high = (args.profile.riskFlags ?? []).filter(
        (r) => r.severity === 'high',
      );
      if (high.length === 0) return null;
      return makeTrigger(
        args,
        { kind: 'admin.high_severity_risk_flag', urgency: 5 },
        {
          summary: `${high.length} high-severity risk flag(s) open.`,
          suggestedAction: 'Investigate and remediate immediately.',
          suggestedPromptForChat: 'What high-severity risks are open and how do I close them?',
          triggeringEvidence: high
            .slice(0, 3)
            .map((r) => ({ kind: 'signal' as const, id: r.kind })),
        },
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Prospect rules
// ---------------------------------------------------------------------------

const prospectRules: ReadonlyArray<TriggerRule> = [
  {
    id: 'prospect.viewing_pattern_ready_to_tour',
    kind: 'prospect.viewing_pattern_ready_to_tour',
    applicableRoles: ['prospect'],
    evaluate(args) {
      if (!isProspect(args.profile)) return null;
      const views = args.profile.propertiesViewed ?? [];
      if (views.length < 3) return null;
      return makeTrigger(
        args,
        { kind: 'prospect.viewing_pattern_ready_to_tour', urgency: 3 },
        {
          summary: `Viewed ${views.length} properties — high tour intent.`,
          suggestedAction: 'Offer to schedule a tour for the most-viewed listing.',
          suggestedPromptForChat: 'I would like to book a tour. What slots are available?',
          triggeringEvidence: views
            .slice(0, 3)
            .map((v) => ({ kind: 'property' as const, id: v.propertyId })),
        },
      );
    },
  },
  {
    id: 'prospect.saved_listing_aging',
    kind: 'prospect.saved_listing_aging',
    applicableRoles: ['prospect'],
    evaluate(args) {
      if (!isProspect(args.profile)) return null;
      const saved = args.profile.savedListings ?? [];
      const now = args.now ?? new Date();
      const aging = saved.filter(
        (s) =>
          now.getTime() - Date.parse(s.savedAt) >=
          1000 * 60 * 60 * 24 * 14,
      );
      if (aging.length === 0) return null;
      return makeTrigger(
        args,
        { kind: 'prospect.saved_listing_aging', urgency: 2 },
        {
          summary: `${aging.length} saved listing(s) untouched for 14+ days.`,
          suggestedAction: 'Nudge with updated availability and pricing.',
          suggestedPromptForChat:
            'I saved some listings a while ago — are they still available?',
          triggeringEvidence: aging
            .slice(0, 3)
            .map((s) => ({ kind: 'property' as const, id: s.propertyId })),
        },
      );
    },
  },
];

/**
 * Full catalogue of trigger rules (29+). The engine filters by role at
 * evaluation time.
 */
export const ALL_TRIGGER_RULES: ReadonlyArray<TriggerRule> = [
  ...tenantRules,
  ...ownerRules,
  ...pmRules,
  ...adminRules,
  ...prospectRules,
];
