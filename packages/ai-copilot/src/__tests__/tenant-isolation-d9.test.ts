/**
 * Tenant isolation — D9/G4 denial audit hook.
 *
 * Verifies that:
 *   - `validateTenantScope` emits rows with verdict='detected'
 *   - `assertTenantScope` emits rows with verdict='blocked' before throwing
 *   - `assertQueryHasTenantFilter` emits rows with verdict='blocked'
 *   - sink errors NEVER propagate (audit is best-effort)
 *   - registering `null` resets the sink
 */

import { afterEach, describe, it, expect } from 'vitest';
import {
  assertQueryHasTenantFilter,
  assertTenantScope,
  createInMemoryCrossTenantDenialSink,
  setCrossTenantDenialSink,
  TenantBoundaryError,
  validateTenantScope,
} from '../security/tenant-isolation.js';

afterEach(() => {
  setCrossTenantDenialSink(null);
});

describe('cross-tenant denial audit (D9/G4)', () => {
  it('validateTenantScope records detected violations', () => {
    const sink = createInMemoryCrossTenantDenialSink();
    setCrossTenantDenialSink(sink);

    const result = validateTenantScope(
      { rows: [{ tenant_id: 'tnt_B', amount: 100 }] },
      { tenantId: 'tnt_A', actorId: 'usr_42' },
      { surface: 'tool.lookupTenantArrears', traceId: 'trace_xyz' },
    );
    expect(result.safe).toBe(false);
    const rows = sink.rows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].verdict).toBe('detected');
    expect(rows[0].callerTenantId).toBe('tnt_A');
    expect(rows[0].foreignTenantId).toBe('tnt_B');
    expect(rows[0].actorId).toBe('usr_42');
    expect(rows[0].surface).toBe('tool.lookupTenantArrears');
    expect(rows[0].traceId).toBe('trace_xyz');
  });

  it('assertTenantScope records blocked verdicts before throwing', () => {
    const sink = createInMemoryCrossTenantDenialSink();
    setCrossTenantDenialSink(sink);

    expect(() =>
      assertTenantScope(
        { rec: { organizationId: 'tnt_OTHER' } },
        { tenantId: 'tnt_HOME' },
      ),
    ).toThrow(TenantBoundaryError);

    const rows = sink.rows();
    expect(rows.length).toBe(1);
    expect(rows[0].verdict).toBe('blocked');
    expect(rows[0].callerTenantId).toBe('tnt_HOME');
  });

  it('assertQueryHasTenantFilter records blocked verdicts when no tenant filter present', () => {
    const sink = createInMemoryCrossTenantDenialSink();
    setCrossTenantDenialSink(sink);

    expect(() =>
      assertQueryHasTenantFilter(
        'list_invoices',
        { status: 'OPEN' },
        { tenantId: 'tnt_A' },
      ),
    ).toThrow(TenantBoundaryError);
    expect(sink.rows()[0].verdict).toBe('blocked');
    expect(sink.rows()[0].violationType).toBe('missing_tenant_filter');
  });

  it('survives a sink that throws synchronously', () => {
    const throwy = {
      record() {
        throw new Error('boom');
      },
    };
    setCrossTenantDenialSink(throwy);

    // The validation result must still be returned cleanly.
    const result = validateTenantScope(
      { tenant_id: 'tnt_OTHER' },
      { tenantId: 'tnt_HOME' },
    );
    expect(result.safe).toBe(false);
  });

  it('survives a sink that rejects asynchronously', async () => {
    const rejecty = {
      record(): Promise<void> {
        return Promise.reject(new Error('async boom'));
      },
    };
    setCrossTenantDenialSink(rejecty);

    // Should not throw.
    const result = validateTenantScope(
      { tenant_id: 'tnt_OTHER' },
      { tenantId: 'tnt_HOME' },
    );
    expect(result.safe).toBe(false);
    // Allow the rejection to settle.
    await new Promise((r) => setTimeout(r, 5));
  });

  it('does not record rows when context is clean', () => {
    const sink = createInMemoryCrossTenantDenialSink();
    setCrossTenantDenialSink(sink);
    const result = validateTenantScope(
      { rows: [{ tenant_id: 'tnt_A', amount: 100 }] },
      { tenantId: 'tnt_A' },
    );
    expect(result.safe).toBe(true);
    expect(sink.rows().length).toBe(0);
  });
});
