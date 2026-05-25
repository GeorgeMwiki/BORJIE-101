/**
 * Scope routing — pure helpers.
 */

import { describe, expect, it } from 'vitest';
import { isPlatformWide, policyFor, validateScopeArgs } from '../scope/index.js';

describe('policyFor', () => {
  it('owner-customer requires a tenantId', () => {
    expect(policyFor('owner-customer').tenantIdRequired).toBe(true);
  });

  it('owner-customer is never platform-wide', () => {
    expect(policyFor('owner-customer').platformWideAllowed).toBe(false);
  });

  it('internal-admin does not require a tenantId', () => {
    expect(policyFor('internal-admin').tenantIdRequired).toBe(false);
  });

  it('internal-admin may be platform-wide', () => {
    expect(policyFor('internal-admin').platformWideAllowed).toBe(true);
  });

  it('owner-customer chat noun is "your skill"', () => {
    expect(policyFor('owner-customer').chatNoun).toBe('your skill');
  });

  it('internal-admin chat noun is "the platform skill"', () => {
    expect(policyFor('internal-admin').chatNoun).toBe('the platform skill');
  });
});

describe('validateScopeArgs', () => {
  it('owner-customer + tenantId → ok', () => {
    expect(validateScopeArgs('owner-customer', 'tenant-001')).toBeNull();
  });

  it('owner-customer + null tenantId → error', () => {
    expect(validateScopeArgs('owner-customer', null)).toMatch(/requires a tenantId/);
  });

  it('internal-admin + tenantId → ok (tenant-scoped admin skill)', () => {
    expect(validateScopeArgs('internal-admin', 'tenant-001')).toBeNull();
  });

  it('internal-admin + null tenantId → ok (platform-wide)', () => {
    expect(validateScopeArgs('internal-admin', null)).toBeNull();
  });
});

describe('isPlatformWide', () => {
  it('internal-admin + null tenantId → true', () => {
    expect(isPlatformWide({ scope: 'internal-admin', tenantId: null })).toBe(true);
  });

  it('internal-admin + tenantId → false', () => {
    expect(isPlatformWide({ scope: 'internal-admin', tenantId: 'tenant-X' })).toBe(false);
  });

  it('owner-customer is never platform-wide', () => {
    expect(isPlatformWide({ scope: 'owner-customer', tenantId: 'tenant-X' })).toBe(false);
  });

  it('owner-customer + null tenantId is still not platform-wide', () => {
    expect(isPlatformWide({ scope: 'owner-customer', tenantId: null })).toBe(false);
  });
});
