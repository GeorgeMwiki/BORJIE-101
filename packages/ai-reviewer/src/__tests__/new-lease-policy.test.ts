import { describe, it, expect } from 'vitest';
import { newLeasePolicy } from '../policies/new-lease-policy.js';
import { makeReq } from './fixtures.js';

describe('newLeasePolicy', () => {
  it('preChecks reports each missing required field', () => {
    const issues = newLeasePolicy.preChecks(makeReq('new_lease', {}));
    expect(issues.some((i) => i.code === 'lease.unitId.missing')).toBe(true);
    expect(issues.some((i) => i.code === 'lease.tenantPartyId.missing')).toBe(true);
    expect(issues.some((i) => i.code === 'lease.landlordPartyId.missing')).toBe(true);
    expect(issues.some((i) => i.code === 'lease.startDate.missing')).toBe(true);
    expect(issues.some((i) => i.code === 'lease.endDate.missing')).toBe(true);
    expect(issues.some((i) => i.code === 'lease.rent.missing')).toBe(true);
  });

  it('preChecks rejects negative rent', () => {
    const issues = newLeasePolicy.preChecks(
      makeReq('new_lease', { monthlyRent: -100 }),
    );
    expect(issues.some((i) => i.code === 'lease.rent.negative')).toBe(true);
  });

  it('preChecks rejects end date <= start date', () => {
    const issues = newLeasePolicy.preChecks(
      makeReq('new_lease', { startDate: '2026-05-01', endDate: '2026-04-30' }),
    );
    expect(issues.some((i) => i.code === 'lease.dates.end_before_start')).toBe(true);
  });

  it('redLines triggers on > 60 day back-date', () => {
    // submittedAt is 2026-05-24; start 2026-01-01 ⇒ ~143 days back
    const redLines = newLeasePolicy.redLines(
      makeReq('new_lease', { startDate: '2026-01-01' }),
    );
    expect(redLines.some((i) => i.code === 'lease.start.excessive_backdate')).toBe(true);
  });

  it('redLines triggers on conflicting active lease', () => {
    const redLines = newLeasePolicy.redLines(
      makeReq('new_lease', {
        conflictingActiveLeaseIds: ['l1'],
      }),
    );
    expect(redLines.some((i) => i.code === 'lease.conflict.active_overlap')).toBe(true);
  });
});
