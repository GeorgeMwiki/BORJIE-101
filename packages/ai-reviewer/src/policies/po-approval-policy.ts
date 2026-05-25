/**
 * Purchase-order approval policy.
 *
 * Approves a PO. Pre-checks make sure the PO has line items and a
 * total. Red-lines block approvals over the actor's authority limit
 * and approvals where the requisition the PO derives from is missing
 * or in a non-approved state.
 */

import type { PolicyRule, ValidationIssue } from '../types.js';
import { issue, readArray, readNumber, readString } from './_helpers.js';

interface RoleLimit {
  readonly role: string;
  readonly limit: number;
}

const ROLE_LIMITS: ReadonlyArray<RoleLimit> = [
  { role: 'admin', limit: Number.POSITIVE_INFINITY },
  { role: 'finance_manager', limit: 500_000 },
  { role: 'property_manager', limit: 50_000 },
  { role: 'site_supervisor', limit: 5_000 },
];

function limitFor(role: string): number {
  const match = ROLE_LIMITS.find((r) => r.role === role);
  return match ? match.limit : 0;
}

export const poApprovalPolicy: PolicyRule<Readonly<Record<string, unknown>>> = {
  kind: 'po_approval',

  preChecks(req) {
    const issues: ValidationIssue[] = [];
    const poId = readString(req.payload, ['poId']);
    if (!poId) {
      issues.push(issue('po.id.missing', 'poId is required.', 'error', 'poId'));
    }
    const lineItems = readArray(req.payload, ['lineItems']) ?? [];
    if (lineItems.length === 0) {
      issues.push(
        issue('po.line_items.empty', 'PO must have at least one line item.', 'error', 'lineItems'),
      );
    }
    const total = readNumber(req.payload, ['totalAmount']);
    if (total === undefined) {
      issues.push(
        issue('po.total.missing', 'totalAmount is required.', 'error', 'totalAmount'),
      );
    } else if (total < 0) {
      issues.push(
        issue('po.total.negative', 'totalAmount cannot be negative.', 'error', 'totalAmount'),
      );
    }
    return issues;
  },

  redLines(req) {
    const redLines: ValidationIssue[] = [];
    const total = readNumber(req.payload, ['totalAmount']);
    if (total !== undefined) {
      const limit = limitFor(req.context.actorRole);
      if (total > limit) {
        redLines.push(
          issue(
            'po.amount.exceeds_authority',
            `PO total ${total} exceeds the ${limit} authority limit for role "${req.context.actorRole}". Escalate to a higher authority.`,
            'critical',
            'totalAmount',
          ),
        );
      }
    }
    const requisitionStatus = readString(req.payload, ['requisitionStatus']);
    if (requisitionStatus !== undefined && requisitionStatus !== 'approved') {
      redLines.push(
        issue(
          'po.requisition.not_approved',
          `Cannot approve a PO whose source requisition is in status "${requisitionStatus}".`,
          'critical',
          'requisitionStatus',
        ),
      );
    }
    return redLines;
  },

  brainPrompt(req) {
    const poId = readString(req.payload, ['poId']) ?? '(missing)';
    const total = readNumber(req.payload, ['totalAmount']);
    const vendorId = readString(req.payload, ['vendorId']) ?? '(missing)';
    return [
      `You are reviewing PO ${poId} (vendor ${vendorId}) for tenant ${req.context.tenantId}.`,
      `Total: ${total ?? '?'}.`,
      `Assess whether the line-item descriptions, unit prices, and vendor make sense as a single PO.`,
    ].join(' ');
  },
};
