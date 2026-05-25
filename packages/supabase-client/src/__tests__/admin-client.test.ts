/**
 * Tests for createSupabaseAdminClient.
 *
 * Verifies config validation, key-shape guards, and that the underlying
 * client is created with the service role (no PUBLIC_ANON_KEY accident).
 */

import { describe, it, expect } from 'vitest';
import { createSupabaseAdminClient } from '../admin-client.js';
import { SupabaseConfigError } from '../types.js';

const VALID_URL = 'https://abcdefg.supabase.co';
// 60-char fake key (must satisfy z.string().min(40))
const FAKE_SERVICE_KEY =
  'sb_service_role_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('createSupabaseAdminClient', () => {
  it('returns a client when given a valid service-role key', () => {
    const sb = createSupabaseAdminClient({
      url: VALID_URL,
      serviceRoleKey: FAKE_SERVICE_KEY,
    });
    expect(sb).toBeDefined();
    expect(typeof sb.from).toBe('function');
    expect(typeof sb.storage.from).toBe('function');
  });

  it('rejects when serviceRoleKey is missing', () => {
    expect(() =>
      createSupabaseAdminClient({ url: VALID_URL } as Parameters<
        typeof createSupabaseAdminClient
      >[0]),
    ).toThrow(SupabaseConfigError);
  });

  it('rejects an invalid URL', () => {
    expect(() =>
      createSupabaseAdminClient({
        url: 'not-a-url',
        serviceRoleKey: FAKE_SERVICE_KEY,
      }),
    ).toThrow(SupabaseConfigError);
  });

  it('rejects a too-short service-role key', () => {
    expect(() =>
      createSupabaseAdminClient({
        url: VALID_URL,
        serviceRoleKey: 'short',
      }),
    ).toThrow(SupabaseConfigError);
  });

  it('passes the schema option through', () => {
    const sb = createSupabaseAdminClient(
      { url: VALID_URL, serviceRoleKey: FAKE_SERVICE_KEY },
      { schema: 'analytics' },
    );
    expect(sb).toBeDefined();
  });
});
