/**
 * Requisition-submission policy.
 *
 * A requisition is a request to purchase. Pre-checks ensure the
 * requester, items, justification, and budget code are present.
 * Red-lines block submissions against a budget code that is exhausted
 * or that target a vendor the tenant has marked blacklisted.
 */

import type { PolicyRule, ValidationIssue } from '../types.js';
import { issue, readArray, readBoolean, readNumber, readString } from './_helpers.js';

export const requisitionSubmissionPolicy: PolicyRule<Readonly<Record<string, unknown>>> = {
  kind: 'requisition_submission',

  preChecks(req) {
    const issues: ValidationIssue[] = [];
    const items = readArray(req.payload, ['items']) ?? [];
    if (items.length === 0) {
      issues.push(
        issue(
          'requisition.items.empty',
          'A requisition must list at least one item.',
          'error',
          'items',
        ),
      );
    }
    const justification = readString(req.payload, ['justification']);
    if (!justification || justification.trim().length < 20) {
      issues.push(
        issue(
          'requisition.justification.too_short',
          'Justification must be at least 20 characters.',
          'error',
          'justification',
        ),
      );
    }
    const budgetCode = readString(req.payload, ['budgetCode']);
    if (!budgetCode) {
      issues.push(
        issue(
          'requisition.budget_code.missing',
          'budgetCode is required.',
          'error',
          'budgetCode',
        ),
      );
    }
    const estTotal = readNumber(req.payload, ['estimatedTotal']);
    if (estTotal === undefined) {
      issues.push(
        issue(
          'requisition.estimated_total.missing',
          'estimatedTotal is required.',
          'error',
          'estimatedTotal',
        ),
      );
    } else if (estTotal <= 0) {
      issues.push(
        issue(
          'requisition.estimated_total.non_positive',
          'estimatedTotal must be greater than zero.',
          'error',
          'estimatedTotal',
        ),
      );
    }
    return issues;
  },

  redLines(req) {
    const redLines: ValidationIssue[] = [];
    const remaining = readNumber(req.payload, ['budgetRemaining']);
    const estTotal = readNumber(req.payload, ['estimatedTotal']);
    if (remaining !== undefined && estTotal !== undefined && estTotal > remaining) {
      redLines.push(
        issue(
          'requisition.budget.exhausted',
          `Requisition total ${estTotal} exceeds remaining budget ${remaining}.`,
          'critical',
          'estimatedTotal',
        ),
      );
    }
    const vendorBlacklisted = readBoolean(req.payload, ['vendorBlacklisted']);
    if (vendorBlacklisted === true) {
      const vendorId = readString(req.payload, ['vendorId']) ?? '(unknown)';
      redLines.push(
        issue(
          'requisition.vendor.blacklisted',
          `Vendor ${vendorId} is on the tenant blacklist; cannot requisition.`,
          'critical',
          'vendorId',
        ),
      );
    }
    return redLines;
  },

  brainPrompt(req) {
    const items = readArray(req.payload, ['items']) ?? [];
    const total = readNumber(req.payload, ['estimatedTotal']);
    const budgetCode = readString(req.payload, ['budgetCode']) ?? '(missing)';
    return [
      `You are reviewing a requisition with ${items.length} item(s), estimated total ${total ?? '?'}, against budget code ${budgetCode} for tenant ${req.context.tenantId}.`,
      `Assess whether the items genuinely match the budget code's purpose and whether the unit prices look plausible.`,
    ].join(' ');
  },
};
