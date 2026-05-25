import { describe, it, expect } from 'vitest';
import { maintenanceCompletionPolicy } from '../policies/maintenance-completion-policy.js';
import { makeReq } from './fixtures.js';

describe('maintenanceCompletionPolicy', () => {
  it('preChecks reports missing ticketId, short notes, missing resolution', () => {
    const issues = maintenanceCompletionPolicy.preChecks(makeReq('maintenance_completion', {}));
    expect(issues.some((i) => i.code === 'maintenance.ticket.missing')).toBe(true);
    expect(issues.some((i) => i.code === 'maintenance.notes.too_short')).toBe(true);
    expect(issues.some((i) => i.code === 'maintenance.resolution.missing')).toBe(true);
  });

  it('redLines blocks invalid resolution code', () => {
    const redLines = maintenanceCompletionPolicy.redLines(
      makeReq('maintenance_completion', { resolutionCode: 'magic_dust' }),
    );
    expect(redLines.some((i) => i.code === 'maintenance.resolution.invalid')).toBe(true);
  });

  it('redLines blocks unpaid invoice at closure', () => {
    const redLines = maintenanceCompletionPolicy.redLines(
      makeReq('maintenance_completion', {
        resolutionCode: 'fixed',
        invoiceTotal: 100,
        invoicePaid: false,
        completionPhotos: ['p1'],
      }),
    );
    expect(
      redLines.some((i) => i.code === 'maintenance.invoice.unpaid_at_completion'),
    ).toBe(true);
  });

  it('redLines requires photo when closing as "fixed"', () => {
    const redLines = maintenanceCompletionPolicy.redLines(
      makeReq('maintenance_completion', {
        resolutionCode: 'fixed',
        completionPhotos: [],
      }),
    );
    expect(redLines.some((i) => i.code === 'maintenance.fixed.requires_photo')).toBe(true);
  });

  it('redLines empty for valid "no_fault_found" with no invoice', () => {
    const redLines = maintenanceCompletionPolicy.redLines(
      makeReq('maintenance_completion', {
        resolutionCode: 'no_fault_found',
      }),
    );
    expect(redLines).toEqual([]);
  });
});
