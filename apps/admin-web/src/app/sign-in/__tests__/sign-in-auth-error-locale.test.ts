/**
 * GATE (A8): raw English Supabase error rendered on a Swahili console.
 *
 * Supabase Auth returns English-only strings on `error.message`
 * ("Invalid login credentials", "Email not confirmed", …). The sign-in
 * form previously stored `error.message` (and `err.message`) directly on
 * the error banner, painting English onto a Swahili surface — a zero-mix
 * canon violation.
 *
 * `localizeAuthError` classifies the raw string and returns a message in
 * the ACTIVE locale only. This gate asserts: (1) a known auth error maps
 * to the SW string (no English residue) when locale is `sw`; (2) the SAME
 * error maps to the EN string when locale is `en`; (3) an unrecognized
 * error still returns a localized generic — never the raw English. It
 * BITES: rendering `error.message` verbatim would leave "Invalid" (EN) on
 * the sw surface, failing the no-English assertion.
 */
import { describe, expect, it } from 'vitest';
import { localizeAuthError } from '../sign-in-form';

describe('localizeAuthError (A8)', () => {
  it('localizes invalid-credentials to Swahili with no English residue', () => {
    const msg = localizeAuthError('Invalid login credentials', 'sw');
    expect(msg).toBe('Barua pepe au nenosiri si sahihi.');
    expect(msg.toLowerCase()).not.toContain('invalid');
    expect(msg.toLowerCase()).not.toContain('credentials');
  });

  it('localizes the same error to English when locale is en', () => {
    const msg = localizeAuthError('Invalid login credentials', 'en');
    expect(msg).toBe('Incorrect email or password.');
  });

  it('localizes an unknown auth error to a generic — never the raw string', () => {
    const raw = 'AuthApiError: schema "auth" does not exist';
    const sw = localizeAuthError(raw, 'sw');
    expect(sw).toBe('Imeshindwa kuingia. Tafadhali jaribu tena.');
    expect(sw).not.toBe(raw);
    expect(sw).not.toContain('AuthApiError');
  });
});
