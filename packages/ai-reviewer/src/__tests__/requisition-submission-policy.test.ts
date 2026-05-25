import { describe, it, expect } from 'vitest';
import { requisitionSubmissionPolicy } from '../policies/requisition-submission-policy.js';
import { makeReq } from './fixtures.js';

describe('requisitionSubmissionPolicy', () => {
  it('preChecks reports empty items / short justification / missing budget / missing total', () => {
    const issues = requisitionSubmissionPolicy.preChecks(
      makeReq('requisition_submission', {}),
    );
    expect(issues.some((i) => i.code === 'requisition.items.empty')).toBe(true);
    expect(issues.some((i) => i.code === 'requisition.justification.too_short')).toBe(true);
    expect(issues.some((i) => i.code === 'requisition.budget_code.missing')).toBe(true);
    expect(issues.some((i) => i.code === 'requisition.estimated_total.missing')).toBe(true);
  });

  it('preChecks rejects non-positive estimated total', () => {
    const issues = requisitionSubmissionPolicy.preChecks(
      makeReq('requisition_submission', { estimatedTotal: 0 }),
    );
    expect(
      issues.some((i) => i.code === 'requisition.estimated_total.non_positive'),
    ).toBe(true);
  });

  it('redLines blocks submission that exceeds remaining budget', () => {
    const redLines = requisitionSubmissionPolicy.redLines(
      makeReq('requisition_submission', {
        estimatedTotal: 1000,
        budgetRemaining: 500,
      }),
    );
    expect(redLines.some((i) => i.code === 'requisition.budget.exhausted')).toBe(true);
  });

  it('redLines blocks blacklisted vendor', () => {
    const redLines = requisitionSubmissionPolicy.redLines(
      makeReq('requisition_submission', {
        vendorBlacklisted: true,
        vendorId: 'v_bad',
      }),
    );
    expect(redLines.some((i) => i.code === 'requisition.vendor.blacklisted')).toBe(true);
  });

  it('redLines empty for in-budget non-blacklisted vendor', () => {
    const redLines = requisitionSubmissionPolicy.redLines(
      makeReq('requisition_submission', {
        estimatedTotal: 100,
        budgetRemaining: 500,
        vendorBlacklisted: false,
      }),
    );
    expect(redLines).toEqual([]);
  });
});
