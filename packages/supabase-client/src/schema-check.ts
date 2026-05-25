/**
 * Idempotent Supabase schema bootstrap check.
 *
 * Verifies that the project has:
 *   - The `public.set_tenant_context(p_tenant_id, p_user_id)` RPC
 *     used by the RLS-aware client.
 *   - Bossnyumba's expected storage buckets (best-effort — does not fail
 *     if a bucket is missing, just reports it).
 *
 * Called during boot in the api-gateway when `AUTH_PROVIDER=supabase`.
 * Returns a structured report so operators can spot drift in CI.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseSchemaError } from './types.js';

export const EXPECTED_BUCKETS = [
  'documents',
  'media-photos',
  'media-videos',
  'media-audio',
  'reports',
  'avatars',
  'tenant-uploads',
] as const;

export type ExpectedBucket = (typeof EXPECTED_BUCKETS)[number];

export interface SchemaReport {
  readonly setTenantContextRpcExists: boolean;
  readonly buckets: ReadonlyArray<{
    readonly name: ExpectedBucket;
    readonly exists: boolean;
  }>;
  readonly errors: ReadonlyArray<string>;
}

/**
 * Run an idempotent schema check. Returns a `SchemaReport`. Throws
 * `SupabaseSchemaError` only when the connection itself fails — schema
 * gaps are surfaced as `errors` so the caller can decide whether to
 * abort or boot in degraded mode.
 */
export async function getOrCreateSupabaseSchema(
  sb: SupabaseClient,
): Promise<SchemaReport> {
  const errors: string[] = [];

  // 1. Check for `public.set_tenant_context` by calling it with a dummy id.
  let rpcOk = false;
  try {
    const { error } = await sb.rpc('set_tenant_context', {
      p_tenant_id: '00000000-0000-0000-0000-000000000000',
      p_user_id: null,
    });
    if (!error) {
      rpcOk = true;
    } else if (error.message.includes('function') && error.message.includes('does not exist')) {
      errors.push(
        'Missing RPC `public.set_tenant_context` — apply `supabase/db-policies.sql`.',
      );
    } else {
      errors.push(`set_tenant_context probe failed: ${error.message}`);
    }
  } catch (err) {
    throw new SupabaseSchemaError(
      `Failed to call set_tenant_context: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  // 2. Check expected storage buckets.
  const bucketStatus: Array<{ name: ExpectedBucket; exists: boolean }> = [];
  try {
    const { data, error } = await sb.storage.listBuckets();
    if (error) {
      errors.push(`storage.listBuckets failed: ${error.message}`);
      for (const name of EXPECTED_BUCKETS) bucketStatus.push({ name, exists: false });
    } else {
      const have = new Set<string>((data ?? []).map((b) => b.name));
      for (const name of EXPECTED_BUCKETS) {
        bucketStatus.push({ name, exists: have.has(name) });
      }
    }
  } catch (err) {
    errors.push(
      `storage.listBuckets threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    for (const name of EXPECTED_BUCKETS) bucketStatus.push({ name, exists: false });
  }

  return {
    setTenantContextRpcExists: rpcOk,
    buckets: bucketStatus,
    errors,
  };
}
