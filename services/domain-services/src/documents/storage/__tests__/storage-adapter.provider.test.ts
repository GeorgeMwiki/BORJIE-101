/**
 * Bridge-provider tests — proves that the `StorageAdapterProvider`
 * enforces `tenantScopedPath(tenantId, key)` on every operation so
 * Supabase Storage RLS will match. The tenant-isolation regression
 * test cases (tenant B trying to read tenant A's key) are the
 * security-critical ones: they catch the "wiring repaired" promise
 * the wiring-gaps audit (chain 6) demands.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  createInMemoryStorageAdapter,
  tenantScopedPath,
} from '@borjie/storage-adapter';
import { createStorageAdapterProvider } from '../storage-adapter.provider.js';

const BUCKET = 'documents';
const TENANT_A = 'tenant-a-uuid';
const TENANT_B = 'tenant-b-uuid';

function setup() {
  const adapter = createInMemoryStorageAdapter();
  const provider = createStorageAdapterProvider({ adapter, bucket: BUCKET });
  return { adapter, provider };
}

describe('createStorageAdapterProvider — basic upload+read', () => {
  it('stores the object under tenantScopedPath(tenantId, key)', async () => {
    const { adapter, provider } = setup();

    const result = await provider.upload({
      tenantId: TENANT_A as never,
      key: 'doc-001.pdf',
      content: Buffer.from('hello'),
      contentType: 'application/pdf',
    });

    // The returned key is the un-scoped key (so callers can persist
    // it without leaking the tenant prefix).
    expect(result.key).toBe('doc-001.pdf');
    // The URL string contains the tenant-scoped path so any debugging
    // or audit log shows the actual physical location.
    expect(result.url).toContain(tenantScopedPath(TENANT_A, 'doc-001.pdf'));

    // The adapter physically holds the bytes at the scoped path.
    const list = await adapter.list(
      BUCKET,
      tenantScopedPath(TENANT_A, 'doc-001.pdf'),
    );
    expect(list.some((o) => o.path === `${TENANT_A}/doc-001.pdf`)).toBe(true);
  });

  it('round-trips upload → exists', async () => {
    const { provider } = setup();
    await provider.upload({
      tenantId: TENANT_A as never,
      key: 'invoice-2026-05.pdf',
      content: Buffer.from('pdf-bytes'),
      contentType: 'application/pdf',
    });

    await expect(
      provider.exists(TENANT_A as never, 'invoice-2026-05.pdf'),
    ).resolves.toBe(true);
  });
});

describe('createStorageAdapterProvider — TENANT ISOLATION REGRESSION', () => {
  it('tenant A upload → tenant B cannot see existence', async () => {
    const { provider } = setup();
    await provider.upload({
      tenantId: TENANT_A as never,
      key: 'private.pdf',
      content: Buffer.from('top-secret-a'),
      contentType: 'application/pdf',
    });

    // Tenant B asks for the same key — exists() must return false
    // because the path it composes is `tenantB/private.pdf`, not
    // `tenantA/private.pdf`.
    await expect(
      provider.exists(TENANT_B as never, 'private.pdf'),
    ).resolves.toBe(false);
  });

  it('tenant A upload → tenant B delete attempt does not delete A', async () => {
    const { provider } = setup();
    await provider.upload({
      tenantId: TENANT_A as never,
      key: 'fileX.pdf',
      content: Buffer.from('data'),
      contentType: 'application/pdf',
    });

    // Tenant B tries to delete the same key — they actually delete
    // their own (non-existent) scoped path, which is a no-op for the
    // in-memory adapter. A's file survives.
    await provider.delete(TENANT_B as never, 'fileX.pdf');

    await expect(
      provider.exists(TENANT_A as never, 'fileX.pdf'),
    ).resolves.toBe(true);
  });

  it('tenant A upload → tenant B getSignedUrl resolves to B-scoped path, not A', async () => {
    const { provider } = setup();
    await provider.upload({
      tenantId: TENANT_A as never,
      key: 'shared-name.pdf',
      content: Buffer.from('A-data'),
      contentType: 'application/pdf',
    });

    const urlA = await provider.getSignedUrl(
      TENANT_A as never,
      'shared-name.pdf',
      { expiresIn: 60 },
    );
    const urlB = await provider.getSignedUrl(
      TENANT_B as never,
      'shared-name.pdf',
      { expiresIn: 60 },
    );

    // The two URLs MUST be different — they point at different
    // tenant-scoped paths even though the same logical key was
    // supplied to both calls.
    expect(urlA).not.toBe(urlB);
    expect(urlA).toContain(TENANT_A);
    expect(urlB).toContain(TENANT_B);
  });

  it('getBaseUrl returns a tenant-scoped prefix', () => {
    const { provider } = setup();
    expect(provider.getBaseUrl(TENANT_A as never)).toContain(TENANT_A);
    expect(provider.getBaseUrl(TENANT_B as never)).toContain(TENANT_B);
    expect(provider.getBaseUrl(TENANT_A as never)).not.toBe(
      provider.getBaseUrl(TENANT_B as never),
    );
  });
});

describe('createStorageAdapterProvider — input safety', () => {
  it('rejects empty tenantId via tenantScopedPath', async () => {
    const { provider } = setup();
    await expect(
      provider.upload({
        tenantId: '' as never,
        key: 'a.pdf',
        content: Buffer.from('x'),
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow(/Invalid tenantId/);
  });

  it('rejects tenantId containing slash via tenantScopedPath', async () => {
    const { provider } = setup();
    await expect(
      provider.upload({
        tenantId: 'foo/../bar' as never,
        key: 'a.pdf',
        content: Buffer.from('x'),
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow(/Invalid tenantId/);
  });

  it('rejects empty key', async () => {
    const { provider } = setup();
    await expect(
      provider.upload({
        tenantId: TENANT_A as never,
        key: '',
        content: Buffer.from('x'),
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow(/fileId required/);
  });

  it('strips leading slashes from key so `tenant//file` never appears', async () => {
    const { adapter, provider } = setup();
    await provider.upload({
      tenantId: TENANT_A as never,
      key: '///nested/photo.jpg',
      content: Buffer.from('x'),
      contentType: 'image/jpeg',
    });

    const all = await adapter.list(BUCKET, `${TENANT_A}/`);
    // The path that actually got written is `tenantA/nested/photo.jpg`
    // — no double-slashes.
    expect(
      all.some((o) => o.path === `${TENANT_A}/nested/photo.jpg`),
    ).toBe(true);
    expect(
      all.some((o) => o.path.includes('//')),
    ).toBe(false);
  });
});
