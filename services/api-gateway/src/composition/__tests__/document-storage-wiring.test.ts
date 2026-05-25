/**
 * Composition-root flip tests for `createDocumentStorageWiring`
 * (P40 follow-up — activates the storage-adapter bridge for
 * DocumentService + EvidencePackBuilderService).
 *
 * What we assert:
 *
 *   - With Supabase env UNSET → wiring returns the
 *     `LocalStorageProvider` fallback. Mode is `'legacy-local'`,
 *     bucket is null. Boot does not crash. This is the dev/CI
 *     default and the production safety net.
 *
 *   - With an injected in-memory `StorageAdapter` (test-only short-
 *     circuit) → wiring returns a `StorageProvider` that round-trips
 *     uploads through `tenantScopedPath(tenantId, key)`. Mode is
 *     `'supabase-adapter'`, bucket is `'documents'`. This proves the
 *     bridge is on the live path without spinning up a Supabase
 *     project in CI.
 *
 *   - With Supabase env SET but client init throws (malformed URL) →
 *     wiring falls back to LocalStorageProvider with a warning. The
 *     gateway never crashes at boot just because the Supabase config
 *     is wrong; the operator sees the warning and fixes the env.
 *
 *   - With Supabase env SET (valid-looking URL + service-role key) →
 *     wiring returns mode `'supabase-adapter'` and a non-null
 *     provider. (We don't make real HTTP calls — the Supabase client
 *     is lazy on the URL, so construction succeeds even with a fake
 *     project URL.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createInMemoryStorageAdapter,
  tenantScopedPath,
} from '@borjie/storage-adapter';
import { createDocumentStorageWiring } from '../document-storage-wiring.js';

const SAVED_ENV: Record<string, string | undefined> = {};
const ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ENVIRONMENT',
  'NODE_ENV',
] as const;

function clearEnv(): void {
  for (const k of ENV_KEYS) {
    SAVED_ENV[k] = process.env[k];
    delete process.env[k];
  }
}

function restoreEnv(): void {
  for (const k of ENV_KEYS) {
    if (SAVED_ENV[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = SAVED_ENV[k];
    }
  }
}

describe('createDocumentStorageWiring — legacy fallback', () => {
  beforeEach(() => {
    clearEnv();
  });
  afterEach(() => {
    restoreEnv();
  });

  it('falls back to LocalStorageProvider when Supabase env is unset', () => {
    const wiring = createDocumentStorageWiring();
    expect(wiring.mode).toBe('legacy-local');
    expect(wiring.bucket).toBeNull();
    expect(wiring.provider).toBeDefined();
    // The LocalStorageProvider always exposes a `getBaseUrl` because
    // it implements the same `StorageProvider` interface as the bridge.
    expect(typeof wiring.provider.getBaseUrl).toBe('function');
  });

  it('falls back to LocalStorageProvider when only the URL is set', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    const wiring = createDocumentStorageWiring();
    expect(wiring.mode).toBe('legacy-local');
  });

  it('falls back to LocalStorageProvider when only the service-role key is set', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
    const wiring = createDocumentStorageWiring();
    expect(wiring.mode).toBe('legacy-local');
  });
});

describe('createDocumentStorageWiring — Supabase env path (in-memory adapter)', () => {
  beforeEach(() => {
    clearEnv();
  });
  afterEach(() => {
    restoreEnv();
  });

  it('binds the storage-adapter bridge when overrideAdapter is supplied', async () => {
    const adapter = createInMemoryStorageAdapter();
    const wiring = createDocumentStorageWiring({ overrideAdapter: adapter });

    expect(wiring.mode).toBe('supabase-adapter');
    expect(wiring.bucket).toBe('documents');

    // Round-trip: an upload through the bridge MUST land at the
    // tenant-scoped path inside the adapter. This proves the bridge
    // is actually wired (not just shaped).
    const TENANT_A = 'tenant-a-uuid' as never;
    const result = await wiring.provider.upload({
      tenantId: TENANT_A,
      key: 'rcpt-001.pdf',
      content: Buffer.from('hello'),
      contentType: 'application/pdf',
    });

    expect(result.key).toBe('rcpt-001.pdf');
    const listed = await adapter.list(
      'documents',
      tenantScopedPath(TENANT_A as unknown as string, 'rcpt-001.pdf'),
    );
    expect(
      listed.some(
        (o) =>
          o.path ===
          tenantScopedPath(TENANT_A as unknown as string, 'rcpt-001.pdf'),
      ),
    ).toBe(true);
  });

  it('keeps two tenants isolated on the bridge path', async () => {
    const adapter = createInMemoryStorageAdapter();
    const wiring = createDocumentStorageWiring({ overrideAdapter: adapter });

    const TENANT_A = 'tenant-a' as never;
    const TENANT_B = 'tenant-b' as never;

    await wiring.provider.upload({
      tenantId: TENANT_A,
      key: 'shared-name.pdf',
      content: Buffer.from('A-data'),
      contentType: 'application/pdf',
    });

    // Same logical key, different tenant → distinct physical paths.
    await expect(
      wiring.provider.exists(TENANT_A, 'shared-name.pdf'),
    ).resolves.toBe(true);
    await expect(
      wiring.provider.exists(TENANT_B, 'shared-name.pdf'),
    ).resolves.toBe(false);
  });
});

describe('createDocumentStorageWiring — Supabase client init safety', () => {
  beforeEach(() => {
    clearEnv();
  });
  afterEach(() => {
    restoreEnv();
  });

  it('falls back to LocalStorageProvider when Supabase client init throws', () => {
    // The Supabase admin client validates the URL eagerly; an empty
    // string trips the SupabaseConfigError. We rely on the wiring
    // catching this and falling back instead of crashing the boot.
    const warnings: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
    const wiring = createDocumentStorageWiring({
      env: {
        // Pass a bogus URL via the env override so the admin client
        // throws synchronously inside the try/catch.
        supabaseUrl: 'not-a-url',
        supabaseServiceRoleKey: 'fake-key',
      },
      logger: {
        info: () => undefined,
        warn: (obj, msg) => warnings.push({ obj, msg }),
      },
    });

    expect(wiring.mode).toBe('legacy-local');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('boots cleanly with valid-looking Supabase env (no HTTP calls)', () => {
    // `createSupabaseAdminClient` does not call out to the network on
    // construction — it only validates the URL shape and the
    // service-role key presence. A well-formed but fake project URL
    // is enough to take the supabase-adapter path.
    const wiring = createDocumentStorageWiring({
      env: {
        supabaseUrl: 'https://fake-project.supabase.co',
        supabaseServiceRoleKey: 'sbp_fakekey_thirtytwo_chars_minimum_padding',
        supabaseEnvironment: 'test',
      },
    });
    expect(wiring.mode).toBe('supabase-adapter');
    expect(wiring.bucket).toBe('documents');
    expect(wiring.provider).toBeDefined();
  });
});
