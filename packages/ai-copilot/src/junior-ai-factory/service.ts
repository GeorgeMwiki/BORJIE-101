/**
 * JuniorAIFactoryService — self-service provisioning for team leads.
 *
 * Lifecycle:
 *   provision(spec)     → JuniorAIRecord, status='active'
 *   list(tenantId, ...) → readonly JuniorAIRecord[]
 *   adjustScope(id, p)  → JuniorAIRecord (policy subset re-validated)
 *   suspend(id, reason) → JuniorAIRecord, status='suspended'
 *   revoke(id)          → JuniorAIRecord, status='revoked' (terminal)
 *
 * The service is intentionally thin — every mutation delegates to the
 * injected repository and every business rule (policy subset, daily cap)
 * is a pure predicate. This keeps the Postgres adapter replaceable and
 * makes the rules independently testable.
 */

import type {
  AutonomyDomain,
  AutonomyPolicy,
  CommunicationsPolicy,
  CompliancePolicy,
  FinancePolicy,
  HRPolicy,
  InsurancePolicy,
  LeasingPolicy,
  LegalProceedingsPolicy,
  MaintenancePolicy,
  MarketingPolicy,
  ProcurementPolicy,
  TenantWelfarePolicy,
} from '../autonomy/types.js';
import {
  DailyActionCapExceededError,
  JuniorAINotActiveError,
  PolicySubsetViolationError,
} from './types.js';
import type {
  JuniorAIAuditEvent,
  JuniorAIAuditKind,
  JuniorAIRecord,
  JuniorAIRepository,
  JuniorAIScopePatch,
  JuniorAISpec,
  ListJuniorAIFilters,
} from './types.js';

export interface JuniorAIFactoryServiceDeps {
  readonly repository: JuniorAIRepository;
  readonly autonomyPolicyLoader: (tenantId: string) => Promise<AutonomyPolicy>;
  readonly clock?: () => Date;
  readonly idFactory?: () => string;
  readonly onAudit?: (event: JuniorAIAuditEvent) => void | Promise<void>;
}

export class JuniorAIFactoryService {
  private readonly deps: JuniorAIFactoryServiceDeps;

  constructor(deps: JuniorAIFactoryServiceDeps) {
    this.deps = deps;
  }

  /**
   * Provision a new junior. Enforces:
   *   - tenantId / teamLeadUserId / mandate are all non-empty.
   *   - toolAllowlist is a non-empty array of strings.
   *   - policySubset ⊆ tenant AutonomyPolicy.
   *   - expiresAt (if present) is in the future.
   *   - maxActionsPerDay (if present) is > 0.
   */
  async provision(spec: JuniorAISpec): Promise<JuniorAIRecord> {
    validateSpec(spec);
    const tenantPolicy = await this.deps.autonomyPolicyLoader(spec.tenantId);
    const violations = validatePolicySubset(spec.policySubset, tenantPolicy);
    if (violations.length > 0) {
      throw new PolicySubsetViolationError(violations);
    }

    const now = this.deps.clock?.() ?? new Date();
    const id = this.deps.idFactory?.() ?? `junior_${now.getTime()}_${randomSuffix()}`;
    const record: JuniorAIRecord = {
      ...spec,
      id,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      status: 'active',
      suspendedReason: null,
      revokedAt: null,
      actionsToday: 0,
      actionsTodayDate: null,
    };
    const inserted = await this.deps.repository.insert(record);
    await this.audit('provisioned', inserted, `Provisioned junior ${inserted.id} for domain ${inserted.domain}.`);
    return inserted;
  }

  async list(
    tenantId: string,
    teamLeadUserId?: string,
    filters: Omit<ListJuniorAIFilters, 'teamLeadUserId'> = {},
  ): Promise<readonly JuniorAIRecord[]> {
    return this.deps.repository.list(tenantId, {
      ...filters,
      teamLeadUserId,
    });
  }

  async get(tenantId: string, id: string): Promise<JuniorAIRecord | null> {
    return this.deps.repository.findById(tenantId, id);
  }

  async adjustScope(
    tenantId: string,
    id: string,
    patch: JuniorAIScopePatch,
  ): Promise<JuniorAIRecord> {
    const existing = await this.requireActive(tenantId, id);
    // JuniorAIRecord fields are `readonly`, so we stage the patch as a
    // writable record then spread into the repository's update signature.
    const patchFields: Record<string, unknown> = {};
    if (patch.policySubset !== undefined) {
      const tenantPolicy = await this.deps.autonomyPolicyLoader(tenantId);
      const violations = validatePolicySubset(patch.policySubset, tenantPolicy);
      if (violations.length > 0) {
        throw new PolicySubsetViolationError(violations);
      }
      patchFields.policySubset = patch.policySubset;
    }
    if (patch.toolAllowlist !== undefined) {
      if (!Array.isArray(patch.toolAllowlist) || patch.toolAllowlist.some((t) => typeof t !== 'string' || !t.trim())) {
        throw new Error('adjustScope(): toolAllowlist must be a non-empty string[]');
      }
      patchFields.toolAllowlist = [...patch.toolAllowlist];
    }
    if (patch.mandate !== undefined) {
      if (!patch.mandate.trim()) {
        throw new Error('adjustScope(): mandate must be non-empty');
      }
      patchFields.mandate = patch.mandate;
    }
    if (patch.lifecycle !== undefined) {
      validateLifecycle(patch.lifecycle, this.deps.clock?.() ?? new Date());
      patchFields.lifecycle = patch.lifecycle;
    }
    patchFields.updatedAt = (this.deps.clock?.() ?? new Date()).toISOString();

    const updated = await this.deps.repository.update(tenantId, id, patchFields);
    await this.audit(
      'scope_adjusted',
      updated,
      `Scope adjusted for junior ${updated.id}.`,
      { patchKeys: Object.keys(patchFields) },
    );
    return updated;
  }

  async suspend(tenantId: string, id: string, reason: string): Promise<JuniorAIRecord> {
    if (!reason.trim()) throw new Error('suspend(): reason must be non-empty');
    const existing = await this.deps.repository.findById(tenantId, id);
    if (!existing) throw new Error(`Junior-AI ${id} not found`);
    if (existing.status === 'revoked') {
      throw new JuniorAINotActiveError(id, 'revoked');
    }
    const updated = await this.deps.repository.update(tenantId, id, {
      status: 'suspended',
      suspendedReason: reason,
      updatedAt: (this.deps.clock?.() ?? new Date()).toISOString(),
    });
    await this.audit('suspended', updated, `Suspended junior ${updated.id}: ${reason}.`);
    return updated;
  }

  async revoke(tenantId: string, id: string): Promise<JuniorAIRecord> {
    const existing = await this.deps.repository.findById(tenantId, id);
    if (!existing) throw new Error(`Junior-AI ${id} not found`);
    const now = this.deps.clock?.() ?? new Date();
    const updated = await this.deps.repository.update(tenantId, id, {
      status: 'revoked',
      revokedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    await this.audit('revoked', updated, `Revoked junior ${updated.id}.`);
    return updated;
  }

  /**
   * Record that a junior took an action. Enforces the `maxActionsPerDay`
   * cap when present. Returns the updated record (with refreshed counter).
   * Downstream executors must call this BEFORE dispatching the action.
   */
  async recordAction(tenantId: string, id: string): Promise<JuniorAIRecord> {
    const existing = await this.requireActive(tenantId, id);
    const now = this.deps.clock?.() ?? new Date();
    const today = now.toISOString().slice(0, 10);
    const sameDay = existing.actionsTodayDate === today;
    const nextCount = sameDay ? existing.actionsToday + 1 : 1;
    const cap = existing.lifecycle.maxActionsPerDay;
    if (cap !== undefined && nextCount > cap) {
      await this.audit(
        'action_capped',
        existing,
        `Junior ${existing.id} hit its ${cap}-per-day cap.`,
      );
      throw new DailyActionCapExceededError(id, cap);
    }
    return this.deps.repository.update(tenantId, id, {
      actionsToday: nextCount,
      actionsTodayDate: today,
      updatedAt: now.toISOString(),
    });
  }

  private async requireActive(tenantId: string, id: string): Promise<JuniorAIRecord> {
    const existing = await this.deps.repository.findById(tenantId, id);
    if (!existing) throw new Error(`Junior-AI ${id} not found`);
    if (existing.status !== 'active') {
      throw new JuniorAINotActiveError(id, existing.status);
    }
    return existing;
  }

  private async audit(
    kind: JuniorAIAuditKind,
    record: JuniorAIRecord,
    summary: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    if (!this.deps.onAudit) return;
    const event: JuniorAIAuditEvent = {
      kind,
      juniorAIId: record.id,
      tenantId: record.tenantId,
      teamLeadUserId: record.teamLeadUserId,
      occurredAt: (this.deps.clock?.() ?? new Date()).toISOString(),
      summary,
      metadata,
    };
    try {
      await this.deps.onAudit(event);
    } catch {
      // Auditing must never block the operation — the caller's audit chain
      // runs outside the transaction.
    }
  }
}

// ---------------------------------------------------------------------------
// Pure validation helpers
// ---------------------------------------------------------------------------

function validateSpec(spec: JuniorAISpec): void {
  if (!spec.tenantId || typeof spec.tenantId !== 'string') {
    throw new Error('provision(): tenantId is required');
  }
  if (!spec.teamLeadUserId || typeof spec.teamLeadUserId !== 'string') {
    throw new Error('provision(): teamLeadUserId is required');
  }
  if (!spec.mandate || !spec.mandate.trim()) {
    throw new Error('provision(): mandate is required');
  }
  if (!Array.isArray(spec.toolAllowlist) || spec.toolAllowlist.length === 0) {
    throw new Error('provision(): toolAllowlist must be a non-empty array');
  }
  if (spec.memoryScope !== 'team' && spec.memoryScope !== 'personal') {
    throw new Error('provision(): memoryScope must be team|personal');
  }
  validateLifecycle(spec.lifecycle, new Date());
}

function validateLifecycle(lifecycle: JuniorAISpec['lifecycle'], now: Date): void {
  if (lifecycle.expiresAt !== undefined) {
    const parsed = new Date(lifecycle.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('lifecycle.expiresAt must be a valid ISO timestamp');
    }
    if (parsed.getTime() <= now.getTime()) {
      throw new Error('lifecycle.expiresAt must be in the future');
    }
  }
  if (lifecycle.maxActionsPerDay !== undefined) {
    if (!Number.isInteger(lifecycle.maxActionsPerDay) || lifecycle.maxActionsPerDay <= 0) {
      throw new Error('lifecycle.maxActionsPerDay must be a positive integer');
    }
  }
}

/**
 * Ensure `subset` never grants broader authority than the tenant's
 * `AutonomyPolicy`. Rules, per-domain:
 *
 *   - Boolean flags in subset must be <= tenant (true may only appear
 *     where tenant is also true).
 *   - Numeric thresholds in subset must be <= tenant for "auto-approve
 *     below X" style knobs.
 *   - For escalate-above thresholds, subset must be <= tenant too (a
 *     junior cannot choose to skip escalation the head requires).
 */
export function validatePolicySubset(
  subset: Partial<AutonomyPolicy>,
  tenant: AutonomyPolicy,
): readonly string[] {
  const violations: string[] = [];
  if (subset.finance) checkFinance(subset.finance, tenant.finance, violations);
  if (subset.leasing) checkLeasing(subset.leasing, tenant.leasing, violations);
  if (subset.maintenance) checkMaintenance(subset.maintenance, tenant.maintenance, violations);
  if (subset.compliance) checkCompliance(subset.compliance, tenant.compliance, violations);
  if (subset.communications)
    checkCommunications(subset.communications, tenant.communications, violations);
  if (subset.marketing) checkMarketing(subset.marketing, tenant.marketing, violations);
  if (subset.hr) checkHR(subset.hr, tenant.hr, violations);
  if (subset.procurement) checkProcurement(subset.procurement, tenant.procurement, violations);
  if (subset.insurance) checkInsurance(subset.insurance, tenant.insurance, violations);
  if (subset.legal_proceedings)
    checkLegal(subset.legal_proceedings, tenant.legal_proceedings, violations);
  if (subset.tenant_welfare)
    checkWelfare(subset.tenant_welfare, tenant.tenant_welfare, violations);
  return violations;
}

function checkBoolLTE(
  value: boolean | undefined,
  tenant: boolean,
  path: string,
  violations: string[],
): void {
  if (value === true && tenant === false) {
    violations.push(`${path}: junior cannot enable what tenant policy disables`);
  }
}

function checkNumberLTE(
  value: number | undefined,
  tenant: number,
  path: string,
  violations: string[],
): void {
  if (value !== undefined && value > tenant) {
    violations.push(`${path}: ${value} exceeds tenant cap ${tenant}`);
  }
}

function checkFinance(sub: Partial<FinancePolicy>, t: FinancePolicy, v: string[]): void {
  checkBoolLTE(sub.autoSendReminders, t.autoSendReminders, 'finance.autoSendReminders', v);
  checkNumberLTE(sub.autoApproveRefundsMinorUnits, t.autoApproveRefundsMinorUnits, 'finance.autoApproveRefundsMinorUnits', v);
  checkNumberLTE(sub.autoApproveWaiversMinorUnits, t.autoApproveWaiversMinorUnits, 'finance.autoApproveWaiversMinorUnits', v);
  checkNumberLTE(sub.escalateArrearsAboveMinorUnits, t.escalateArrearsAboveMinorUnits, 'finance.escalateArrearsAboveMinorUnits', v);
}

function checkLeasing(sub: Partial<LeasingPolicy>, t: LeasingPolicy, v: string[]): void {
  checkBoolLTE(sub.autoApproveRenewalsSameTerms, t.autoApproveRenewalsSameTerms, 'leasing.autoApproveRenewalsSameTerms', v);
  checkBoolLTE(sub.autoSendOfferLetters, t.autoSendOfferLetters, 'leasing.autoSendOfferLetters', v);
  checkNumberLTE(sub.maxAutoApproveRentIncreasePct, t.maxAutoApproveRentIncreasePct, 'leasing.maxAutoApproveRentIncreasePct', v);
}

function checkMaintenance(sub: Partial<MaintenancePolicy>, t: MaintenancePolicy, v: string[]): void {
  checkBoolLTE(sub.autoDispatchTrustedVendors, t.autoDispatchTrustedVendors, 'maintenance.autoDispatchTrustedVendors', v);
  checkBoolLTE(sub.autoCloseResolvedTickets, t.autoCloseResolvedTickets, 'maintenance.autoCloseResolvedTickets', v);
  checkNumberLTE(sub.autoApproveBelowMinorUnits, t.autoApproveBelowMinorUnits, 'maintenance.autoApproveBelowMinorUnits', v);
}

function checkCompliance(sub: Partial<CompliancePolicy>, t: CompliancePolicy, v: string[]): void {
  checkBoolLTE(sub.autoDraftNotices, t.autoDraftNotices, 'compliance.autoDraftNotices', v);
  // Runtime check — `autoSendLegalNotices` is a literal `false` in the
  // policy type; callers passing `true` via an untyped JSON payload
  // must still be rejected.
  if ((sub as { autoSendLegalNotices?: unknown }).autoSendLegalNotices === true) {
    v.push('compliance.autoSendLegalNotices: forbidden — legal notices never auto-send');
  }
}

function checkCommunications(sub: Partial<CommunicationsPolicy>, t: CommunicationsPolicy, v: string[]): void {
  checkBoolLTE(sub.autoSendRoutineUpdates, t.autoSendRoutineUpdates, 'communications.autoSendRoutineUpdates', v);
  checkBoolLTE(sub.autoTranslateToTenantLanguage, t.autoTranslateToTenantLanguage, 'communications.autoTranslateToTenantLanguage', v);
}

function checkMarketing(sub: Partial<MarketingPolicy>, t: MarketingPolicy, v: string[]): void {
  checkBoolLTE(sub.autoPublishListings, t.autoPublishListings, 'marketing.autoPublishListings', v);
  checkBoolLTE(sub.autoSendOpenHouseInvites, t.autoSendOpenHouseInvites, 'marketing.autoSendOpenHouseInvites', v);
  checkNumberLTE(sub.autoAdjustAskingRentPct, t.autoAdjustAskingRentPct, 'marketing.autoAdjustAskingRentPct', v);
  checkNumberLTE(sub.monthlyAdSpendCapMinorUnits, t.monthlyAdSpendCapMinorUnits, 'marketing.monthlyAdSpendCapMinorUnits', v);
}

function checkHR(sub: Partial<HRPolicy>, t: HRPolicy, v: string[]): void {
  checkBoolLTE(sub.autoOnboardContractors, t.autoOnboardContractors, 'hr.autoOnboardContractors', v);
  checkBoolLTE(sub.autoIssueCertificatesOfEmployment, t.autoIssueCertificatesOfEmployment, 'hr.autoIssueCertificatesOfEmployment', v);
  checkNumberLTE(sub.autoApprovePayrollBelowMinorUnits, t.autoApprovePayrollBelowMinorUnits, 'hr.autoApprovePayrollBelowMinorUnits', v);
}

function checkProcurement(sub: Partial<ProcurementPolicy>, t: ProcurementPolicy, v: string[]): void {
  checkBoolLTE(sub.autoRenewVendorContracts, t.autoRenewVendorContracts, 'procurement.autoRenewVendorContracts', v);
  checkNumberLTE(sub.autoIssuePurchaseOrdersBelowMinorUnits, t.autoIssuePurchaseOrdersBelowMinorUnits, 'procurement.autoIssuePurchaseOrdersBelowMinorUnits', v);
}

function checkInsurance(sub: Partial<InsurancePolicy>, t: InsurancePolicy, v: string[]): void {
  checkNumberLTE(sub.autoFileClaimsBelowMinorUnits, t.autoFileClaimsBelowMinorUnits, 'insurance.autoFileClaimsBelowMinorUnits', v);
}

function checkLegal(sub: Partial<LegalProceedingsPolicy>, t: LegalProceedingsPolicy, v: string[]): void {
  checkBoolLTE(sub.autoDraftEvictionNotices, t.autoDraftEvictionNotices, 'legal_proceedings.autoDraftEvictionNotices', v);
  checkBoolLTE(sub.autoScheduleMediation, t.autoScheduleMediation, 'legal_proceedings.autoScheduleMediation', v);
  if ((sub as { autoFileToTribunal?: unknown }).autoFileToTribunal === true) {
    v.push('legal_proceedings.autoFileToTribunal: forbidden — tribunal filings never auto-submit');
  }
}

function checkWelfare(sub: Partial<TenantWelfarePolicy>, t: TenantWelfarePolicy, v: string[]): void {
  checkBoolLTE(sub.autoEnrollInHardshipRelief, t.autoEnrollInHardshipRelief, 'tenant_welfare.autoEnrollInHardshipRelief', v);
  checkNumberLTE(sub.autoOfferPaymentPlansBelowMinorUnits, t.autoOfferPaymentPlansBelowMinorUnits, 'tenant_welfare.autoOfferPaymentPlansBelowMinorUnits', v);
}

// Keep AutonomyDomain referenced so it survives `tsc --noEmit` even when
// downstream consumers import `AutonomyDomain` from the barrel.
type _EnforceDomain = AutonomyDomain;

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

// ---------------------------------------------------------------------------
// In-memory repository (tests + degraded mode)
// ---------------------------------------------------------------------------

export class InMemoryJuniorAIRepository implements JuniorAIRepository {
  private readonly store = new Map<string, JuniorAIRecord>();

  async insert(record: JuniorAIRecord): Promise<JuniorAIRecord> {
    this.store.set(key(record.tenantId, record.id), record);
    return record;
  }

  async findById(tenantId: string, id: string): Promise<JuniorAIRecord | null> {
    return this.store.get(key(tenantId, id)) ?? null;
  }

  async list(
    tenantId: string,
    filters: ListJuniorAIFilters,
  ): Promise<readonly JuniorAIRecord[]> {
    const rows = Array.from(this.store.values())
      .filter((r) => r.tenantId === tenantId)
      .filter((r) => (filters.teamLeadUserId ? r.teamLeadUserId === filters.teamLeadUserId : true))
      .filter((r) => (filters.domain ? r.domain === filters.domain : true))
      .filter((r) => (filters.status ? r.status === filters.status : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows;
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<JuniorAIRecord>,
  ): Promise<JuniorAIRecord> {
    const existing = this.store.get(key(tenantId, id));
    if (!existing) throw new Error(`Junior-AI ${id} not found`);
    const next: JuniorAIRecord = { ...existing, ...patch };
    this.store.set(key(tenantId, id), next);
    return next;
  }
}

function key(tenantId: string, id: string): string {
  return `${tenantId}::${id}`;
}
