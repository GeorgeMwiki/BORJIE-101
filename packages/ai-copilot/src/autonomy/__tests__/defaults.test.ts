/**
 * Tests for autonomy/defaults — Wave 27 Part B.9 default policy builder.
 *
 * Coverage: structural shape, conservative defaults (no auto-send legal,
 * no auto-file tribunal), opinionated thresholds, dimensions constant.
 */

import { describe, it, expect } from 'vitest';
import { buildDefaultPolicy, DELEGATION_MATRIX_DIMENSIONS } from '../defaults.js';

describe('buildDefaultPolicy', () => {
  it('returns a policy bound to the supplied tenantId', () => {
    const policy = buildDefaultPolicy('tenant-abc');
    expect(policy.tenantId).toBe('tenant-abc');
  });

  it('starts with autonomous mode disabled', () => {
    const policy = buildDefaultPolicy('t1');
    expect(policy.autonomousModeEnabled).toBe(false);
  });

  it('encodes the arrears-ladder reminder offsets exactly', () => {
    const policy = buildDefaultPolicy('t1');
    expect(policy.finance.reminderDayOffsets).toEqual([5, 10, 20]);
  });

  it('NEVER enables auto-send for legal notices', () => {
    const policy = buildDefaultPolicy('t1');
    expect(policy.compliance.autoSendLegalNotices).toBe(false);
  });

  it('NEVER enables auto-file to tribunal', () => {
    const policy = buildDefaultPolicy('t1');
    expect(policy.legal_proceedings.autoFileToTribunal).toBe(false);
  });

  it('escalates safety-critical maintenance immediately', () => {
    const policy = buildDefaultPolicy('t1');
    expect(policy.maintenance.escalateSafetyCriticalImmediately).toBe(true);
  });

  it('caps auto-approve rent increase at 8 percent', () => {
    const policy = buildDefaultPolicy('t1');
    expect(policy.leasing.maxAutoApproveRentIncreasePct).toBe(8);
  });

  it('seeds escalation contacts as null/empty', () => {
    const policy = buildDefaultPolicy('t1');
    expect(policy.escalation.primaryUserId).toBeNull();
    expect(policy.escalation.secondaryUserId).toBeNull();
    expect(policy.escalation.fallbackEmails).toEqual([]);
  });

  it('emits a stable epoch updatedAt on a brand-new policy', () => {
    const policy = buildDefaultPolicy('t1');
    expect(policy.updatedAt).toBe(new Date(0).toISOString());
    expect(policy.updatedBy).toBeNull();
  });

  it('starts version at 1', () => {
    const policy = buildDefaultPolicy('t1');
    expect(policy.version).toBe(1);
  });

  it('keeps every wave-27 add-on domain conservative (auto-X disabled)', () => {
    const policy = buildDefaultPolicy('t1');
    expect(policy.marketing.autoPublishListings).toBe(false);
    expect(policy.marketing.autoAdjustAskingRentPct).toBe(0);
    expect(policy.hr.autoOnboardContractors).toBe(false);
    expect(policy.hr.autoApprovePayrollBelowMinorUnits).toBe(0);
    expect(policy.procurement.autoIssuePurchaseOrdersBelowMinorUnits).toBe(0);
    expect(policy.procurement.escalateSingleSourceAwards).toBe(true);
    expect(policy.insurance.escalateCoverageGaps).toBe(true);
    expect(policy.tenant_welfare.escalateVulnerableHouseholds).toBe(true);
  });

  it('returns a fresh object each call (no shared reference)', () => {
    const a = buildDefaultPolicy('t1');
    const b = buildDefaultPolicy('t1');
    expect(a).not.toBe(b);
    expect(a.finance).not.toBe(b.finance);
  });
});

describe('DELEGATION_MATRIX_DIMENSIONS', () => {
  it('reports 11 domains and 6 action types', () => {
    expect(DELEGATION_MATRIX_DIMENSIONS.domains).toBe(11);
    expect(DELEGATION_MATRIX_DIMENSIONS.actionTypes).toBe(6);
  });

  it('totalCells equals domains * actionTypes', () => {
    expect(DELEGATION_MATRIX_DIMENSIONS.totalCells).toBe(
      DELEGATION_MATRIX_DIMENSIONS.domains * DELEGATION_MATRIX_DIMENSIONS.actionTypes,
    );
  });
});
