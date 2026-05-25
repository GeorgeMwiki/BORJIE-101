/**
 * Default Approval Policies
 * Maintenance cost thresholds, auto-approve rules, multi-level chains, timeout/escalation
 */

import type { ApprovalPolicy, ApprovalType, ApprovalThreshold, AutoApproveRule, ApprovalLevel } from './types.js';
import type { TenantId, UserId } from '@borjie/domain-models';

/** Create default policy for a type - used when tenant has no custom policy */
export function getDefaultPolicyForType(
  type: ApprovalType,
  tenantId: TenantId,
  updatedBy: UserId
): ApprovalPolicy {
  const now = new Date().toISOString();
  const { thresholds, autoApproveRules, approvalChain, defaultTimeoutHours, autoEscalateToRole } =
    getDefaultPolicyTemplate(type);
  return {
    tenantId,
    type,
    thresholds,
    autoApproveRules,
    approvalChain,
    defaultTimeoutHours,
    autoEscalateToRole,
    updatedAt: now,
    updatedBy,
  };
}

function getDefaultPolicyTemplate(type: ApprovalType): {
  thresholds: ApprovalThreshold[];
  autoApproveRules: AutoApproveRule[];
  approvalChain: ApprovalLevel[];
  defaultTimeoutHours: number;
  autoEscalateToRole: string | null;
} {
  switch (type) {
    case 'maintenance_cost':
      return {
        thresholds: [
          { minAmount: 0, maxAmount: 500, requiredRole: 'estate_manager', approvalLevel: 1 },
          { minAmount: 500, maxAmount: 5000, requiredRole: 'property_manager', approvalLevel: 2 },
          { minAmount: 5000, maxAmount: null, requiredRole: 'owner', approvalLevel: 3 },
        ],
        autoApproveRules: [
          { maxAmount: 100, maxAmountCurrency: 'USD', appliesToRoles: ['estate_manager', 'property_manager'] },
        ],
        approvalChain: [
          { level: 1, requiredRole: 'estate_manager', timeoutHours: 24, escalateToRole: 'property_manager' },
          { level: 2, requiredRole: 'property_manager', timeoutHours: 48, escalateToRole: 'owner' },
          { level: 3, requiredRole: 'owner', timeoutHours: 72, escalateToRole: null },
        ],
        defaultTimeoutHours: 48,
        autoEscalateToRole: 'owner',
      };
    case 'lease_exception':
      return {
        thresholds: [{ minAmount: 0, maxAmount: null, requiredRole: 'property_manager', approvalLevel: 1 }],
        autoApproveRules: [],
        approvalChain: [
          { level: 1, requiredRole: 'property_manager', timeoutHours: 72, escalateToRole: 'owner' },
        ],
        defaultTimeoutHours: 72,
        autoEscalateToRole: 'owner',
      };
    case 'refund':
      return {
        thresholds: [
          { minAmount: 0, maxAmount: 500, requiredRole: 'estate_manager', approvalLevel: 1 },
          { minAmount: 500, maxAmount: 5000, requiredRole: 'property_manager', approvalLevel: 2 },
          { minAmount: 5000, maxAmount: null, requiredRole: 'owner', approvalLevel: 3 },
        ],
        autoApproveRules: [
          { maxAmount: 50, maxAmountCurrency: 'USD', appliesToRoles: ['estate_manager'] },
        ],
        approvalChain: [
          { level: 1, requiredRole: 'estate_manager', timeoutHours: 24, escalateToRole: 'property_manager' },
          { level: 2, requiredRole: 'property_manager', timeoutHours: 48, escalateToRole: 'owner' },
          { level: 3, requiredRole: 'owner', timeoutHours: 72, escalateToRole: null },
        ],
        defaultTimeoutHours: 24,
        autoEscalateToRole: 'owner',
      };
    case 'discount':
      return {
        thresholds: [
          { minAmount: 0, maxAmount: 1000, requiredRole: 'estate_manager', approvalLevel: 1 },
          { minAmount: 1000, maxAmount: null, requiredRole: 'property_manager', approvalLevel: 2 },
        ],
        autoApproveRules: [
          { maxAmount: 100, maxAmountCurrency: 'USD', appliesToRoles: ['estate_manager'] },
        ],
        approvalChain: [
          { level: 1, requiredRole: 'estate_manager', timeoutHours: 48, escalateToRole: 'property_manager' },
          { level: 2, requiredRole: 'property_manager', timeoutHours: 72, escalateToRole: null },
        ],
        defaultTimeoutHours: 48,
        autoEscalateToRole: 'property_manager',
      };
    case 'payment_flexibility':
      // Tier-based routing — amount is the arrangement principal (e.g.
      // deferred balance or accumulated late fee). Escalation follows the
      // deterministic payment risk level that the caller attaches to the
      // request.
      return {
        thresholds: [
          { minAmount: 0, maxAmount: 500, requiredRole: 'estate_manager', approvalLevel: 1 },
          { minAmount: 500, maxAmount: 2500, requiredRole: 'property_manager', approvalLevel: 2 },
          { minAmount: 2500, maxAmount: null, requiredRole: 'owner', approvalLevel: 3 },
        ],
        autoApproveRules: [
          // Small late-fee waivers auto-approved by estate manager
          { maxAmount: 50, maxAmountCurrency: 'USD', appliesToRoles: ['estate_manager'] },
        ],
        approvalChain: [
          { level: 1, requiredRole: 'estate_manager', timeoutHours: 24, escalateToRole: 'property_manager' },
          { level: 2, requiredRole: 'property_manager', timeoutHours: 48, escalateToRole: 'owner' },
          { level: 3, requiredRole: 'owner', timeoutHours: 72, escalateToRole: null },
        ],
        defaultTimeoutHours: 48,
        autoEscalateToRole: 'owner',
      };
    default:
      throw new Error(`Unknown approval type: ${type}`);
  }
}
