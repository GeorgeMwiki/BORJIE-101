/**
 * Tests for the MinIO/S3 path-prefix wrapper.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  tenantPath,
  assertTenantPrefixedPath,
  wrapStorageWithTenantPrefix,
  type S3LikeClient,
} from '../storage/tenant-path-prefix.js';
import { runInTenantContext } from '../context/tenant-context.js';
import { asTenantId, IsolationViolation, type TenantContext, type TenantId } from '../types.js';

function makeCtx(t: string): TenantContext {
  const tid = asTenantId(t) as TenantId;
  return { tenantId: tid, actorTenantId: tid, requestId: 'req_storage_test' };
}

describe('tenant-path-prefix', () => {
  it('tenantPath builds canonical leading-segment key', () => {
    const t = asTenantId('tenant_alpha') as TenantId;
    expect(tenantPath(t, 'reports/2026/q1.pdf')).toBe('tenant_alpha/reports/2026/q1.pdf');
  });

  it('tenantPath rejects leading-slash inputs', () => {
    const t = asTenantId('tenant_alpha') as TenantId;
    expect(() => tenantPath(t, '/reports/x.pdf')).toThrowError(IsolationViolation);
  });

  it('tenantPath is idempotent if input already has the tenant prefix', () => {
    const t = asTenantId('tenant_alpha') as TenantId;
    expect(tenantPath(t, 'tenant_alpha/reports/x.pdf')).toBe('tenant_alpha/reports/x.pdf');
  });

  it('assertTenantPrefixedPath throws on cross-tenant path', async () => {
    const ctx = makeCtx('tenant_alpha');
    await runInTenantContext(ctx, () => {
      expect(() => assertTenantPrefixedPath('tenant_beta/x.pdf')).toThrowError(IsolationViolation);
    });
  });

  it('wrapped storage client auto-prefixes unprefixed object keys', async () => {
    const spy = vi.fn().mockResolvedValue({});
    const client: S3LikeClient = {
      putObject: (a) => spy('put', a),
      getObject: (a) => spy('get', a),
      listObjects: (a) => spy('list', a),
      deleteObject: (a) => spy('del', a),
    };
    const wrapped = wrapStorageWithTenantPrefix(client);
    const ctx = makeCtx('tenant_alpha');
    await runInTenantContext(ctx, async () => {
      await wrapped.putObject({ Bucket: 'b', Key: 'reports/x.pdf', Body: '...' });
      await wrapped.listObjects({ Bucket: 'b' });
    });
    expect(spy).toHaveBeenCalledWith('put', expect.objectContaining({ Key: 'tenant_alpha/reports/x.pdf' }));
    expect(spy).toHaveBeenCalledWith('list', expect.objectContaining({ Prefix: 'tenant_alpha/' }));
  });
});
