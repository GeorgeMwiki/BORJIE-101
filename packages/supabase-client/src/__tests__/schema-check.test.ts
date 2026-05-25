/**
 * Tests for getOrCreateSupabaseSchema.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  getOrCreateSupabaseSchema,
  EXPECTED_BUCKETS,
} from '../schema-check.js';
import { SupabaseSchemaError } from '../types.js';
import type { SupabaseClient } from '@supabase/supabase-js';

function makeMockClient(opts: {
  rpcError?: { message: string } | null;
  rpcThrows?: boolean;
  bucketNames?: string[];
  listBucketsError?: { message: string } | null;
}): SupabaseClient {
  return {
    rpc: vi.fn(async () => {
      if (opts.rpcThrows) throw new Error('connection refused');
      return { data: null, error: opts.rpcError ?? null };
    }),
    storage: {
      listBuckets: vi.fn(async () => ({
        data: (opts.bucketNames ?? []).map((name) => ({ name })),
        error: opts.listBucketsError ?? null,
      })),
    },
  } as unknown as SupabaseClient;
}

describe('getOrCreateSupabaseSchema', () => {
  it('reports OK when RPC + all buckets exist', async () => {
    const sb = makeMockClient({
      bucketNames: [...EXPECTED_BUCKETS],
    });
    const report = await getOrCreateSupabaseSchema(sb);
    expect(report.setTenantContextRpcExists).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.buckets).toHaveLength(EXPECTED_BUCKETS.length);
    for (const b of report.buckets) {
      expect(b.exists).toBe(true);
    }
  });

  it('reports missing RPC as a recoverable error', async () => {
    const sb = makeMockClient({
      rpcError: { message: 'function set_tenant_context does not exist' },
    });
    const report = await getOrCreateSupabaseSchema(sb);
    expect(report.setTenantContextRpcExists).toBe(false);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('set_tenant_context');
  });

  it('reports missing buckets', async () => {
    const sb = makeMockClient({
      bucketNames: ['documents'],
    });
    const report = await getOrCreateSupabaseSchema(sb);
    const missing = report.buckets.filter((b) => !b.exists);
    expect(missing.length).toBe(EXPECTED_BUCKETS.length - 1);
  });

  it('handles listBuckets error gracefully', async () => {
    const sb = makeMockClient({
      listBucketsError: { message: 'permission denied' },
    });
    const report = await getOrCreateSupabaseSchema(sb);
    expect(report.errors.some((e) => e.includes('permission denied'))).toBe(true);
    for (const b of report.buckets) expect(b.exists).toBe(false);
  });

  it('throws SupabaseSchemaError when the RPC call throws', async () => {
    const sb = makeMockClient({ rpcThrows: true });
    await expect(getOrCreateSupabaseSchema(sb)).rejects.toThrow(SupabaseSchemaError);
  });
});
