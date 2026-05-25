/**
 * Tests for createSupabaseRlsAwareClient.
 *
 * Verifies that `client.rls(fn)` triggers a `set_tenant_context` RPC
 * with the bound tenantId BEFORE invoking `fn`. Uses a mock SupabaseClient
 * to capture the RPC calls without touching the network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseRlsAwareClient } from '../rls-aware-client.js';
import { SupabaseConfigError } from '../types.js';

const URL = 'https://abcdefg.supabase.co';
const SERVICE = 'sb_service_role_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

vi.mock('@supabase/supabase-js', () => {
  return {
    createClient: vi.fn(() => {
      const rpcCalls: Array<{ fn: string; args: unknown }> = [];
      const queries: string[] = [];
      const sb = {
        rpc: vi.fn(async (fn: string, args: unknown) => {
          rpcCalls.push({ fn, args });
          return { data: null, error: null };
        }),
        from: vi.fn((table: string) => {
          queries.push(table);
          return {
            select: vi.fn(async () => ({ data: [], error: null })),
          };
        }),
        // expose probes for the test
        __rpcCalls: rpcCalls,
        __queries: queries,
      };
      return sb;
    }),
  };
});

interface MockSupabase {
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  __rpcCalls: Array<{ fn: string; args: unknown }>;
  __queries: string[];
}

describe('createSupabaseRlsAwareClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects missing tenantId', () => {
    expect(() =>
      createSupabaseRlsAwareClient({
        url: URL,
        serviceRoleKey: SERVICE,
        tenantId: '',
      }),
    ).toThrow(SupabaseConfigError);
  });

  it('calls set_tenant_context before running the user callback', async () => {
    const client = createSupabaseRlsAwareClient({
      url: URL,
      serviceRoleKey: SERVICE,
      tenantId: 'tenant-abc',
      userId: 'user-1',
    });

    let sawRpcBeforeQuery = false;
    await client.rls(async (sb) => {
      const mock = sb as unknown as MockSupabase;
      // At this point, `set_tenant_context` should already have been called.
      sawRpcBeforeQuery =
        mock.__rpcCalls.length === 1 &&
        mock.__rpcCalls[0]?.fn === 'set_tenant_context';
      await sb.from('leases').select();
    });
    expect(sawRpcBeforeQuery).toBe(true);

    const mock = (client.raw as unknown) as MockSupabase;
    expect(mock.__rpcCalls).toEqual([
      {
        fn: 'set_tenant_context',
        args: { p_tenant_id: 'tenant-abc', p_user_id: 'user-1' },
      },
    ]);
    expect(mock.__queries).toEqual(['leases']);
  });

  it('passes null userId when not provided', async () => {
    const client = createSupabaseRlsAwareClient({
      url: URL,
      serviceRoleKey: SERVICE,
      tenantId: 'tenant-xyz',
    });
    await client.rls(async () => undefined);

    const mock = (client.raw as unknown) as MockSupabase;
    expect(mock.__rpcCalls[0]?.args).toEqual({
      p_tenant_id: 'tenant-xyz',
      p_user_id: null,
    });
  });

  it('re-applies context on each rls() call (tenant scope is per-rpc)', async () => {
    const client = createSupabaseRlsAwareClient({
      url: URL,
      serviceRoleKey: SERVICE,
      tenantId: 'tenant-multi',
    });
    await client.rls(async () => undefined);
    await client.rls(async () => undefined);
    await client.rls(async () => undefined);

    const mock = (client.raw as unknown) as MockSupabase;
    expect(mock.__rpcCalls).toHaveLength(3);
    for (const call of mock.__rpcCalls) {
      expect(call.fn).toBe('set_tenant_context');
    }
  });

  it('throws SupabaseConfigError when set_tenant_context returns an error', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    (createClient as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => ({
        rpc: vi.fn(async () => ({
          data: null,
          error: { message: 'function does not exist' },
        })),
        from: vi.fn(),
      }),
    );

    const client = createSupabaseRlsAwareClient({
      url: URL,
      serviceRoleKey: SERVICE,
      tenantId: 'tenant-fail',
    });

    await expect(client.rls(async () => undefined)).rejects.toThrow(
      SupabaseConfigError,
    );
  });
});
