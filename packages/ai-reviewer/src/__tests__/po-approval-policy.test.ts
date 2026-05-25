import { describe, it, expect } from 'vitest';
import { poApprovalPolicy } from '../policies/po-approval-policy.js';
import { makeReq } from './fixtures.js';

describe('poApprovalPolicy', () => {
  it('preChecks reports missing poId / line items / total', () => {
    const issues = poApprovalPolicy.preChecks(makeReq('po_approval', {}));
    expect(issues.some((i) => i.code === 'po.id.missing')).toBe(true);
    expect(issues.some((i) => i.code === 'po.line_items.empty')).toBe(true);
    expect(issues.some((i) => i.code === 'po.total.missing')).toBe(true);
  });

  it('preChecks rejects negative total', () => {
    const issues = poApprovalPolicy.preChecks(
      makeReq('po_approval', { totalAmount: -1 }),
    );
    expect(issues.some((i) => i.code === 'po.total.negative')).toBe(true);
  });

  it('redLines blocks PO that exceeds property_manager authority', () => {
    // property_manager limit is 50_000
    const redLines = poApprovalPolicy.redLines(
      makeReq('po_approval', { totalAmount: 100_000 }),
    );
    expect(redLines.some((i) => i.code === 'po.amount.exceeds_authority')).toBe(true);
  });

  it('redLines allows admin to approve any amount', () => {
    const redLines = poApprovalPolicy.redLines(
      makeReq(
        'po_approval',
        { totalAmount: 5_000_000, requisitionStatus: 'approved' },
        { actorRole: 'admin' },
      ),
    );
    expect(redLines).toEqual([]);
  });

  it('redLines blocks PO when source requisition is not approved', () => {
    const redLines = poApprovalPolicy.redLines(
      makeReq('po_approval', { totalAmount: 100, requisitionStatus: 'pending' }),
    );
    expect(redLines.some((i) => i.code === 'po.requisition.not_approved')).toBe(true);
  });
});
