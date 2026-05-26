/**
 * Tests for AsyncLocalStorage tenant context.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */
import { describe, it, expect } from 'vitest';
import {
  runInTenantContext,
  getTenantContext,
  tryGetTenantContext,
  assertSameTenant,
} from '../context/tenant-context.js';
import { asTenantId, IsolationViolation, type TenantContext, type TenantId } from '../types.js';

function makeCtx(t: string): TenantContext {
  const tid = asTenantId(t) as TenantId;
  return {
    tenantId: tid,
    actorTenantId: tid,
    requestId: 'req_test_1',
  };
}

describe('tenant-context', () => {
  it('getTenantContext throws IsolationViolation when no context is bound', () => {
    expect(() => getTenantContext()).toThrowError(IsolationViolation);
  });

  it('tryGetTenantContext returns null when no context is bound', () => {
    expect(tryGetTenantContext()).toBeNull();
  });

  it('runInTenantContext binds a context for the duration of the callback', async () => {
    const ctx = makeCtx('tenant_alpha');
    const observed = await runInTenantContext(ctx, () => getTenantContext());
    expect(observed.tenantId).toBe('tenant_alpha');
  });

  it('assertSameTenant throws when observed tenant differs from context', async () => {
    const ctx = makeCtx('tenant_alpha');
    await runInTenantContext(ctx, () => {
      expect(() => assertSameTenant('tenant_beta')).toThrowError(IsolationViolation);
    });
  });

  it('assertSameTenant succeeds when observed tenant matches', async () => {
    const ctx = makeCtx('tenant_alpha');
    await runInTenantContext(ctx, () => {
      expect(() => assertSameTenant('tenant_alpha')).not.toThrow();
    });
  });

  it('asTenantId rejects malformed values', () => {
    expect(asTenantId('')).toBeNull();
    expect(asTenantId('has space')).toBeNull();
    expect(asTenantId('has:colon')).toBeNull();
    expect(asTenantId('has/slash')).toBeNull();
    expect(asTenantId('tenant_alpha')).toBe('tenant_alpha');
  });
});
