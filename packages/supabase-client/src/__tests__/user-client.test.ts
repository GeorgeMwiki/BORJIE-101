/**
 * Tests for createSupabaseUserClient.
 */

import { describe, it, expect } from 'vitest';
import { createSupabaseUserClient } from '../user-client.js';
import { SupabaseConfigError } from '../types.js';

const URL = 'https://abcdefg.supabase.co';
const ANON =
  'sb_anon_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TOKEN = 'jwt.payload.signature-aaaaaaaaaaaaaaaa';

describe('createSupabaseUserClient', () => {
  it('builds a client with anon key + access token', () => {
    const sb = createSupabaseUserClient({
      url: URL,
      anonKey: ANON,
      accessToken: TOKEN,
    });
    expect(sb).toBeDefined();
    expect(typeof sb.from).toBe('function');
  });

  it('rejects a missing anonKey', () => {
    expect(() =>
      createSupabaseUserClient({
        url: URL,
        accessToken: TOKEN,
      } as Parameters<typeof createSupabaseUserClient>[0]),
    ).toThrow(SupabaseConfigError);
  });

  it('rejects a missing accessToken', () => {
    expect(() =>
      createSupabaseUserClient({
        url: URL,
        anonKey: ANON,
        accessToken: '',
      }),
    ).toThrow(SupabaseConfigError);
  });

  it('rejects a too-short accessToken (likely a typo)', () => {
    expect(() =>
      createSupabaseUserClient({
        url: URL,
        anonKey: ANON,
        accessToken: 'short',
      }),
    ).toThrow(SupabaseConfigError);
  });
});
