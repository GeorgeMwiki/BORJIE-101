/**
 * Proposal templates.
 *
 * A ProposalTemplate is a pure drafter: given a Signal, it returns a fully
 * populated Proposal (minus the proposalId + draftedAt, which the
 * orchestrator stamps). Templates are tiny, testable, and independent of
 * one another. Every template also declares an autonomy `action` so the
 * orchestrator can check it against the tenant's autonomy policy before
 * auto-execution.
 *
 * Eight templates ship by default — the design target for Wave 28.
 */
import { randomUUID } from 'node:crypto';
import type { AutonomyDomain } from '../autonomy/types.js';
import type {
  ApprovalReason,
  Proposal,
  Signal,
  SignalSourceId,
} from './types.js';

// ---------------------------------------------------------------------------
// Template contract
// ---------------------------------------------------------------------------

export interface ProposalTemplate {
  readonly templateId: string;
  /** Signal source the template is fed from. */
  readonly sourceId: SignalSourceId;
  /** Autonomy domain of the action this proposal drafts. */
  readonly domain: AutonomyDomain;
  /** Autonomy action name, passed to AutonomyPolicyService.isAuthorized. */
  readonly autonomyAction: string;
  /**
   * Templates tagged safety_critical NEVER auto-execute. They always route
   * to approval even when the autonomy policy would allow it.
   */
  readonly safetyCritical: boolean;
  /** Does this signal match the template? (cheap predicate) */
  matches(signal: Signal): boolean;
  /** Draft a proposal from a matching signal. */
  draft(signal: Signal): Omit<Proposal, 'proposalId' | 'draftedAt'>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Pick a property from a payload with a typed fallback. Widens the return
 * to `string | T` so downstream comparisons against *other* string literals
 * typecheck (e.g. `pick(payload, 'flag', 'on_band') === 'below_market'`).
 */
function pick<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  fallback: T,
): string | T {
  const v = obj[key];
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return fallback;
  return String(v);
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// 1. marketing_campaign_launch
//    Source: market-surveillance → `below_market` drift
//    Suggestion: launch a paid listing refresh + open-house invite wave.
// ---------------------------------------------------------------------------

export const marketingCampaignLaunchTemplate: ProposalTemplate = {
  templateId: 'marketing_campaign_launch',
  sourceId: 'market-surveillance',
  domain: 'marketing',
  autonomyAction: 'publish_campaign',
  safetyCritical: false,
  matches(signal) {
    return (
      signal.source === 'market-surveillance' &&
      pick(signal.payload as Record<string, unknown>, 'driftFlag', 'on_band') === 'below_market'
    );
  },
  draft(signal) {
    const deltaPct = num((signal.payload as Record<string, unknown>).deltaPct, 0);
    const magnitude = Math.abs(deltaPct);
    return {
      signalId: signal.signalId,
      tenantId: signal.tenantId,
      domain: 'marketing',
      templateId: 'marketing_campaign_launch',
      title: 'Launch marketing campaign — unit is below market',
      rationale: `Market-surveillance reports this unit rents ${(magnitude * 100).toFixed(1)}% below the 30-day market median. A targeted campaign should close the gap.`,
      suggestedAction: 'Publish refreshed listing + send open-house invite wave for affected unit.',
      estimatedImpact: {
        metric: 'expected_rent_recovery_pct',
        magnitude,
        unit: 'percent',
      },
      confidence: Math.min(1, 0.6 + magnitude),
      requiresApprovalBecause: null,
    };
  },
};

// ---------------------------------------------------------------------------
// 2. rent_adjustment
//    Source: market-surveillance → `above_market` or `below_market`
//    Suggestion: adjust asking rent towards market median.
// ---------------------------------------------------------------------------

export const rentAdjustmentTemplate: ProposalTemplate = {
  templateId: 'rent_adjustment',
  sourceId: 'market-surveillance',
  domain: 'leasing',
  autonomyAction: 'adjust_asking_rent',
  safetyCritical: false,
  matches(signal) {
    if (signal.source !== 'market-surveillance') return false;
    const flag = pick(signal.payload as Record<string, unknown>, 'driftFlag', 'on_band');
    return flag === 'above_market' || flag === 'below_market';
  },
  draft(signal) {
    const deltaPct = num((signal.payload as Record<string, unknown>).deltaPct, 0);
    const direction = deltaPct > 0 ? 'reduce' : 'raise';
    return {
      signalId: signal.signalId,
      tenantId: signal.tenantId,
      domain: 'leasing',
      templateId: 'rent_adjustment',
      title: `Rent adjustment recommended — ${direction} asking rent`,
      rationale: `Our rent is ${(Math.abs(deltaPct) * 100).toFixed(1)}% off the market median; a ${direction} aligns us with comps.`,
      suggestedAction: `Update next renewal draft with a ${direction} toward market median.`,
      estimatedImpact: {
        metric: 'rent_delta_pct',
        magnitude: Math.abs(deltaPct),
        unit: 'percent',
      },
      confidence: 0.7,
      requiresApprovalBecause: null,
    };
  },
};

// ---------------------------------------------------------------------------
// 3. maintenance_preventive
//    Source: pattern-mining → IoT/maintenance patterns
//    Suggestion: schedule preventive maintenance sweep.
// ---------------------------------------------------------------------------

export const maintenancePreventiveTemplate: ProposalTemplate = {
  templateId: 'maintenance_preventive',
  sourceId: 'pattern-mining',
  domain: 'maintenance',
  autonomyAction: 'schedule_preventive_sweep',
  safetyCritical: false,
  matches(signal) {
    if (signal.source !== 'pattern-mining') return false;
    const title = String(
      pick(signal.payload as Record<string, unknown>, 'title', ''),
    ).toLowerCase();
    return title.includes('maintenance') || title.includes('iot') || title.includes('defect');
  },
  draft(signal) {
    const confidence = num((signal.payload as Record<string, unknown>).confidence, 0.5);
    return {
      signalId: signal.signalId,
      tenantId: signal.tenantId,
      domain: 'maintenance',
      templateId: 'maintenance_preventive',
      title: 'Schedule preventive maintenance sweep',
      rationale: 'Pattern-mining surfaced recurring defects across similar units in this portfolio.',
      suggestedAction: 'Dispatch a preventive-maintenance sweep for all matching units this month.',
      estimatedImpact: {
        metric: 'expected_incidents_avoided',
        magnitude: 1,
        unit: 'count',
      },
      confidence,
      requiresApprovalBecause: null,
    };
  },
};

// ---------------------------------------------------------------------------
// 4. retention_offer
//    Source: sentiment-monitor → sentiment-decay
//    Suggestion: targeted retention outreach (waiver, small credit, etc.)
// ---------------------------------------------------------------------------

export const retentionOfferTemplate: ProposalTemplate = {
  templateId: 'retention_offer',
  sourceId: 'sentiment-monitor',
  domain: 'tenant_welfare',
  autonomyAction: 'send_retention_offer',
  safetyCritical: false,
  matches(signal) {
    // Safety-critical sentiment signals route to the crisis template
    // (registered below) — don't shadow them with the routine
    // retention-offer flow.
    return signal.source === 'sentiment-monitor' && signal.severity !== 'critical';
  },
  draft(signal) {
    const drop =
      num((signal.payload as Record<string, unknown>).previousAvg, 0) -
      num((signal.payload as Record<string, unknown>).currentAvg, 0);
    return {
      signalId: signal.signalId,
      tenantId: signal.tenantId,
      domain: 'tenant_welfare',
      templateId: 'retention_offer',
      title: 'Send retention offer — sentiment decay detected',
      rationale: `Tenant sentiment dropped ${drop.toFixed(2)} over the monitoring window. A timely outreach can prevent churn.`,
      suggestedAction: 'Send a personalised retention offer (credit, waiver, or call from manager).',
      estimatedImpact: {
        metric: 'churn_risk_reduction',
        magnitude: Math.min(1, drop),
        unit: 'probability',
      },
      confidence: 0.6,
      requiresApprovalBecause: null,
    };
  },
};

// ---------------------------------------------------------------------------
// 5. arrears_early_intervention
//    Source: predictive-interventions → high_default_risk
//    Suggestion: proactive payment-plan offer BEFORE the miss.
// ---------------------------------------------------------------------------

export const arrearsEarlyInterventionTemplate: ProposalTemplate = {
  templateId: 'arrears_early_intervention',
  sourceId: 'predictive-interventions',
  domain: 'finance',
  autonomyAction: 'offer_payment_plan',
  safetyCritical: false,
  matches(signal) {
    if (signal.source !== 'predictive-interventions') return false;
    const type = pick(signal.payload as Record<string, unknown>, 'signalType', '');
    return type === 'high_default_risk';
  },
  draft(signal) {
    const strength = num(
      (signal.payload as Record<string, unknown>).signalStrength,
      0,
    );
    return {
      signalId: signal.signalId,
      tenantId: signal.tenantId,
      domain: 'finance',
      templateId: 'arrears_early_intervention',
      title: 'Offer payment plan — default risk elevated',
      rationale: `Predictive model flags default risk at ${(strength * 100).toFixed(0)}% over the horizon. Early intervention outperforms post-default collection.`,
      suggestedAction: 'Offer a 3-month payment plan tailored to tenant history.',
      estimatedImpact: {
        metric: 'default_risk_reduction',
        magnitude: strength * 0.6,
        unit: 'probability',
      },
      confidence: strength,
      requiresApprovalBecause: null,
    };
  },
};

// ---------------------------------------------------------------------------
// 6. lease_renewal_nudge
//    Source: predictive-interventions → high_churn_risk
//    Suggestion: early renewal nudge with incentive.
// ---------------------------------------------------------------------------

export const leaseRenewalNudgeTemplate: ProposalTemplate = {
  templateId: 'lease_renewal_nudge',
  sourceId: 'predictive-interventions',
  domain: 'leasing',
  autonomyAction: 'send_renewal_nudge',
  safetyCritical: false,
  matches(signal) {
    if (signal.source !== 'predictive-interventions') return false;
    return pick(signal.payload as Record<string, unknown>, 'signalType', '') === 'high_churn_risk';
  },
  draft(signal) {
    const strength = num((signal.payload as Record<string, unknown>).signalStrength, 0);
    return {
      signalId: signal.signalId,
      tenantId: signal.tenantId,
      domain: 'leasing',
      templateId: 'lease_renewal_nudge',
      title: 'Send lease-renewal nudge — churn risk elevated',
      rationale: `Churn probability is ${(strength * 100).toFixed(0)}% for this tenant. Early renewal conversation preserves occupancy.`,
      suggestedAction: 'Send renewal nudge with modest incentive (e.g. waived month-one fee).',
      estimatedImpact: {
        metric: 'retention_probability',
        magnitude: strength * 0.5,
        unit: 'probability',
      },
      confidence: 0.7,
      requiresApprovalBecause: null,
    };
  },
};

// ---------------------------------------------------------------------------
// 7. vendor_rotation
//    Source: pattern-mining → QA patterns about poor vendor performance
//    Suggestion: rotate vendor assignments away from underperformers.
// ---------------------------------------------------------------------------

export const vendorRotationTemplate: ProposalTemplate = {
  templateId: 'vendor_rotation',
  sourceId: 'pattern-mining',
  domain: 'procurement',
  autonomyAction: 'rotate_vendor_assignment',
  safetyCritical: false,
  matches(signal) {
    if (signal.source !== 'pattern-mining') return false;
    const title = String(
      pick(signal.payload as Record<string, unknown>, 'title', ''),
    ).toLowerCase();
    return title.includes('vendor') || title.includes('qa') || title.includes('rework');
  },
  draft(signal) {
    return {
      signalId: signal.signalId,
      tenantId: signal.tenantId,
      domain: 'procurement',
      templateId: 'vendor_rotation',
      title: 'Rotate vendor assignments — QA pattern detected',
      rationale: 'Pattern-mining surfaced a repeat-rework or late-completion pattern tied to specific vendors.',
      suggestedAction: 'Rotate next 10 work orders to alternate trusted vendors.',
      estimatedImpact: {
        metric: 'expected_rework_reduction_pct',
        magnitude: 0.2,
        unit: 'percent',
      },
      confidence: num((signal.payload as Record<string, unknown>).confidence, 0.55),
      requiresApprovalBecause: null,
    };
  },
};

// ---------------------------------------------------------------------------
// 8. tenant_wellness_check
//    Source: sentiment-monitor (alternate path when severity is critical)
//    Suggestion: personal wellness check from a human manager.
//    SAFETY-CRITICAL — always routes to approval; this must NOT be
//    auto-executed by the AI, a human makes the call.
// ---------------------------------------------------------------------------

export const tenantWellnessCheckTemplate: ProposalTemplate = {
  templateId: 'tenant_wellness_check',
  sourceId: 'sentiment-monitor',
  domain: 'tenant_welfare',
  autonomyAction: 'flag_for_wellness_check',
  safetyCritical: true,
  matches(signal) {
    return signal.source === 'sentiment-monitor' && signal.severity === 'critical';
  },
  draft(signal) {
    return {
      signalId: signal.signalId,
      tenantId: signal.tenantId,
      domain: 'tenant_welfare',
      templateId: 'tenant_wellness_check',
      title: 'Flag tenant for wellness check',
      rationale: 'Critical sentiment drop detected — may indicate hardship or distress.',
      suggestedAction: 'Manager places a personal phone call to check on tenant wellbeing.',
      estimatedImpact: {
        metric: 'wellbeing_intervention',
        magnitude: 1,
        unit: 'count',
      },
      confidence: 0.9,
      requiresApprovalBecause: 'safety_critical',
    };
  },
};

// ---------------------------------------------------------------------------
// Default registry — exactly the 8 the spec asks for.
// ---------------------------------------------------------------------------

export const DEFAULT_PROPOSAL_TEMPLATES: readonly ProposalTemplate[] = [
  marketingCampaignLaunchTemplate,
  rentAdjustmentTemplate,
  maintenancePreventiveTemplate,
  retentionOfferTemplate,
  arrearsEarlyInterventionTemplate,
  leaseRenewalNudgeTemplate,
  vendorRotationTemplate,
  tenantWellnessCheckTemplate,
] as const;

// ---------------------------------------------------------------------------
// Stamping helpers — add the orchestrator-owned fields to a drafted body.
// ---------------------------------------------------------------------------

export function stampProposal(
  body: Omit<Proposal, 'proposalId' | 'draftedAt'>,
  now: Date,
  overrideApprovalReason?: ApprovalReason,
): Proposal {
  let proposalId: string;
  try {
    proposalId = `prop_${randomUUID()}`;
  } catch {
    proposalId = `prop_${now.getTime()}_${Math.random().toString(36).slice(2, 10)}`;
  }
  return {
    ...body,
    proposalId,
    draftedAt: now.toISOString(),
    requiresApprovalBecause:
      overrideApprovalReason !== undefined ? overrideApprovalReason : body.requiresApprovalBecause,
  };
}
