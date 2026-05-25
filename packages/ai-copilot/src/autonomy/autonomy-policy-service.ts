/**
 * Autonomy policy service — CRUD + authorization.
 *
 * Every autonomous action flows through `isAuthorized(tenantId, domain,
 * action, context)`. The call is synchronous in spirit (single Postgres
 * lookup + pure rule evaluation) so callers can block on it without
 * splashing latency across the request path.
 *
 * The service accepts any repository implementation; the in-memory one
 * is used in tests and the Postgres one wires to the `autonomy_policies`
 * table.
 */

import { buildDefaultPolicy } from './defaults.js';
import type {
  AuthorizationDecision,
  AuthorizeContext,
  AutonomyDomain,
  AutonomyPolicy,
  AutonomyPolicyRepository,
  EscalationContacts,
  UpdatePolicyInput,
} from './types.js';

export interface AutonomyPolicyServiceDeps {
  readonly repository: AutonomyPolicyRepository;
  readonly clock?: () => Date;
}

export class AutonomyPolicyService {
  private readonly deps: AutonomyPolicyServiceDeps;

  constructor(deps: AutonomyPolicyServiceDeps) {
    this.deps = deps;
  }

  async createPolicy(tenantId: string, updatedBy: string): Promise<AutonomyPolicy> {
    const existing = await this.deps.repository.get(tenantId);
    if (existing) return existing;
    const fresh: AutonomyPolicy = {
      ...buildDefaultPolicy(tenantId),
      updatedAt: this.now(),
      updatedBy,
    };
    return this.deps.repository.upsert(fresh);
  }

  async getPolicy(tenantId: string): Promise<AutonomyPolicy> {
    const existing = await this.deps.repository.get(tenantId);
    if (existing) return existing;
    // Callers expect a defaults-shaped policy even if the row is absent.
    return {
      ...buildDefaultPolicy(tenantId),
      updatedAt: this.now(),
    };
  }

  async updatePolicy(
    tenantId: string,
    input: UpdatePolicyInput,
  ): Promise<AutonomyPolicy> {
    const current = await this.getPolicy(tenantId);
    const merged = mergePolicy(current, input, this.now());
    return this.deps.repository.upsert(merged);
  }

  /**
   * Core authorization check. Returns one of three states:
   *   - authorized=true, requiresApproval=false   → act now
   *   - authorized=false, requiresApproval=true   → write to exception inbox
   *   - authorized=false, requiresApproval=false  → hard block (disabled or
   *     safety-critical legal notice)
   */
  async isAuthorized(
    tenantId: string,
    domain: AutonomyDomain,
    action: string,
    context: AuthorizeContext = {},
  ): Promise<AuthorizationDecision> {
    const policy = await this.getPolicy(tenantId);

    if (!policy.autonomousModeEnabled) {
      return {
        authorized: false,
        requiresApproval: true,
        escalateTo: policy.escalation.primaryUserId,
        reason: 'Autonomous mode disabled — head approval required.',
        policyRuleMatched: 'master_switch_off',
      };
    }

    switch (domain) {
      case 'finance':
        return evaluateFinance(policy, action, context);
      case 'leasing':
        return evaluateLeasing(policy, action, context);
      case 'maintenance':
        return evaluateMaintenance(policy, action, context);
      case 'compliance':
        return evaluateCompliance(policy, action, context);
      case 'communications':
        return evaluateCommunications(policy, action, context);
      default:
        return {
          authorized: false,
          requiresApproval: true,
          escalateTo: policy.escalation.primaryUserId,
          reason: `Unknown domain: ${String(domain)}`,
          policyRuleMatched: 'unknown_domain',
        };
    }
  }

  private now(): string {
    return (this.deps.clock?.() ?? new Date()).toISOString();
  }
}

function mergePolicy(
  current: AutonomyPolicy,
  input: UpdatePolicyInput,
  nowIso: string,
): AutonomyPolicy {
  const escalation: EscalationContacts = {
    ...current.escalation,
    ...(input.escalation ?? {}),
    fallbackEmails:
      input.escalation?.fallbackEmails ?? current.escalation.fallbackEmails,
  };
  return {
    ...current,
    autonomousModeEnabled:
      input.autonomousModeEnabled ?? current.autonomousModeEnabled,
    finance: { ...current.finance, ...(input.finance ?? {}) },
    leasing: { ...current.leasing, ...(input.leasing ?? {}) },
    maintenance: { ...current.maintenance, ...(input.maintenance ?? {}) },
    compliance: {
      ...current.compliance,
      ...(input.compliance ?? {}),
      // Never allow toggling this on — type literally is false.
      autoSendLegalNotices: false,
    },
    communications: {
      ...current.communications,
      ...(input.communications ?? {}),
    },
    escalation,
    version: current.version + 1,
    updatedAt: nowIso,
    updatedBy: input.updatedBy ?? current.updatedBy,
  };
}

function approve(reason: string, ruleMatched: string): AuthorizationDecision {
  return {
    authorized: true,
    requiresApproval: false,
    escalateTo: null,
    reason,
    policyRuleMatched: ruleMatched,
  };
}

function requireApproval(
  policy: AutonomyPolicy,
  reason: string,
  ruleMatched: string,
): AuthorizationDecision {
  return {
    authorized: false,
    requiresApproval: true,
    escalateTo: policy.escalation.primaryUserId,
    reason,
    policyRuleMatched: ruleMatched,
  };
}

function block(
  policy: AutonomyPolicy,
  reason: string,
  ruleMatched: string,
): AuthorizationDecision {
  return {
    authorized: false,
    requiresApproval: false,
    escalateTo: policy.escalation.primaryUserId,
    reason,
    policyRuleMatched: ruleMatched,
  };
}

function evaluateFinance(
  policy: AutonomyPolicy,
  action: string,
  ctx: AuthorizeContext,
): AuthorizationDecision {
  const { finance } = policy;
  if (action === 'send_reminder') {
    return finance.autoSendReminders
      ? approve('Reminder cadence approved.', 'finance.auto_send_reminders')
      : requireApproval(policy, 'Reminders not auto-approved.', 'finance.reminders_disabled');
  }
  if (action === 'approve_refund') {
    if (ctx.amountMinorUnits == null) {
      return requireApproval(policy, 'Missing refund amount.', 'finance.refund_missing_amount');
    }
    if (ctx.amountMinorUnits <= finance.autoApproveRefundsMinorUnits) {
      return approve('Under refund threshold.', 'finance.refund_threshold');
    }
    return requireApproval(policy, 'Refund over threshold.', 'finance.refund_over_threshold');
  }
  if (action === 'approve_waiver') {
    if ((ctx.amountMinorUnits ?? Number.MAX_SAFE_INTEGER) <= finance.autoApproveWaiversMinorUnits) {
      return approve('Under waiver threshold.', 'finance.waiver_threshold');
    }
    return requireApproval(policy, 'Waiver over threshold.', 'finance.waiver_over_threshold');
  }
  if (action === 'act_on_arrears') {
    if ((ctx.amountMinorUnits ?? 0) > finance.escalateArrearsAboveMinorUnits) {
      return requireApproval(policy, 'Arrears above escalation ceiling.', 'finance.arrears_escalate');
    }
    return approve('Arrears handled in ladder.', 'finance.arrears_auto');
  }
  return requireApproval(policy, `Unknown finance action: ${action}`, 'finance.unknown_action');
}

function evaluateLeasing(
  policy: AutonomyPolicy,
  action: string,
  ctx: AuthorizeContext,
): AuthorizationDecision {
  const { leasing } = policy;
  if (action === 'approve_renewal') {
    if (!leasing.autoApproveRenewalsSameTerms) {
      return requireApproval(policy, 'Auto-renewals disabled.', 'leasing.renewals_disabled');
    }
    const pct = ctx.rentIncreasePct ?? 0;
    if (pct <= leasing.maxAutoApproveRentIncreasePct) {
      return approve(`Renewal within ${pct}% bump allowance.`, 'leasing.renewal_same_terms');
    }
    return requireApproval(policy, 'Renewal increase above ceiling.', 'leasing.renewal_over_pct');
  }
  if (action === 'approve_application') {
    const score = ctx.applicationScore ?? 0;
    if (score >= leasing.autoApproveApplicationScoreMin) {
      return approve('Application score above threshold.', 'leasing.application_score');
    }
    return requireApproval(policy, 'Application score below threshold.', 'leasing.application_below');
  }
  if (action === 'send_offer_letter') {
    return leasing.autoSendOfferLetters
      ? approve('Offer letter auto-send enabled.', 'leasing.offers_enabled')
      : requireApproval(policy, 'Offer letters require review.', 'leasing.offers_review');
  }
  return requireApproval(policy, `Unknown leasing action: ${action}`, 'leasing.unknown_action');
}

function evaluateMaintenance(
  policy: AutonomyPolicy,
  action: string,
  ctx: AuthorizeContext,
): AuthorizationDecision {
  const { maintenance } = policy;
  if (ctx.isSafetyCritical && maintenance.escalateSafetyCriticalImmediately) {
    return requireApproval(policy, 'Safety-critical ticket — escalated.', 'maintenance.safety_escalate');
  }
  if (action === 'approve_work_order') {
    const amount = ctx.amountMinorUnits ?? Number.MAX_SAFE_INTEGER;
    if (amount <= maintenance.autoApproveBelowMinorUnits) {
      return approve('Work order under threshold.', 'maintenance.below_threshold');
    }
    return requireApproval(policy, 'Work order over threshold.', 'maintenance.over_threshold');
  }
  if (action === 'dispatch_vendor') {
    if (ctx.vendorIsTrusted && maintenance.autoDispatchTrustedVendors) {
      return approve('Trusted vendor dispatch.', 'maintenance.trusted_vendor');
    }
    return requireApproval(policy, 'Non-trusted vendor.', 'maintenance.untrusted_vendor');
  }
  if (action === 'close_ticket') {
    return maintenance.autoCloseResolvedTickets
      ? approve('Auto-close enabled.', 'maintenance.auto_close')
      : requireApproval(policy, 'Closures require review.', 'maintenance.closures_review');
  }
  return requireApproval(policy, `Unknown maintenance action: ${action}`, 'maintenance.unknown_action');
}

function evaluateCompliance(
  policy: AutonomyPolicy,
  action: string,
  ctx: AuthorizeContext,
): AuthorizationDecision {
  const { compliance } = policy;
  if (action === 'draft_notice') {
    return compliance.autoDraftNotices
      ? approve('Drafting notice.', 'compliance.auto_draft')
      : requireApproval(policy, 'Drafting disabled.', 'compliance.drafting_disabled');
  }
  if (action === 'send_notice') {
    if (ctx.isLegalNotice) {
      // Legal notices NEVER auto-send, regardless of master switch.
      return block(policy, 'Legal notices require head sign-off.', 'compliance.legal_notice_blocked');
    }
    return approve('Non-legal notice cleared.', 'compliance.non_legal_notice');
  }
  if (action === 'renew_licence') {
    return approve('Auto-renewing licence within window.', 'compliance.licence_renewal');
  }
  return requireApproval(policy, `Unknown compliance action: ${action}`, 'compliance.unknown_action');
}

function evaluateCommunications(
  policy: AutonomyPolicy,
  action: string,
  ctx: AuthorizeContext,
): AuthorizationDecision {
  const { communications } = policy;
  if (
    ctx.sentimentScore != null &&
    ctx.sentimentScore < communications.escalateNegativeSentimentScoreBelow
  ) {
    return requireApproval(
      policy,
      'Sentiment below escalation threshold.',
      'communications.negative_sentiment',
    );
  }
  if (action === 'send_routine_update') {
    return communications.autoSendRoutineUpdates
      ? approve('Routine update cleared.', 'communications.routine_updates')
      : requireApproval(policy, 'Routine updates disabled.', 'communications.updates_disabled');
  }
  if (action === 'translate_message') {
    return communications.autoTranslateToTenantLanguage
      ? approve('Auto-translate on.', 'communications.translate_on')
      : requireApproval(policy, 'Translate off.', 'communications.translate_off');
  }
  return requireApproval(policy, `Unknown communications action: ${action}`, 'communications.unknown_action');
}

/**
 * In-memory repository for tests and the degraded-mode gateway. Never
 * leak between tenants.
 */
export class InMemoryAutonomyPolicyRepository implements AutonomyPolicyRepository {
  private readonly store = new Map<string, AutonomyPolicy>();

  async get(tenantId: string): Promise<AutonomyPolicy | null> {
    return this.store.get(tenantId) ?? null;
  }

  async upsert(policy: AutonomyPolicy): Promise<AutonomyPolicy> {
    this.store.set(policy.tenantId, policy);
    return policy;
  }
}
