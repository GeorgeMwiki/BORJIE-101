/**
 * HaveIBeenPwned (HIBP) "Pwned Passwords" k-anonymity check.
 *
 * Algorithm (per haveibeenpwned.com/API/v3#PwnedPasswords):
 *
 *   1. SHA-1 the plaintext.
 *   2. Send the FIRST 5 hex chars to /range/{prefix}.
 *   3. Response is `SUFFIX:COUNT\n...` for every breached password whose
 *      SHA-1 starts with that prefix.
 *   4. Match the suffix against the response — if present, the password
 *      is breached. If absent, it isn't (false negatives are impossible
 *      because we sent the full prefix; the only "miss" is HIBP not yet
 *      having ingested the breach).
 *
 * We never send the full hash, so HIBP can never tie a password to a
 * user. This is the textbook k-anonymity pattern.
 *
 * Network access is OPTIONAL — pass a `fetch` shim that returns a
 * canned response for offline / air-gapped tests.
 */

import { createHash } from 'node:crypto';

import type { BreachedCredCheck } from '../types.js';

export type FetchLike = (
  url: string,
  init?: { readonly headers?: Readonly<Record<string, string>> },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}>;

export interface HibpCheckerOptions {
  /** Defaults to `globalThis.fetch` when present. */
  readonly fetch?: FetchLike;
  /** Defaults to `https://api.pwnedpasswords.com`. */
  readonly baseUrl?: string;
  /** Optional User-Agent string — HIBP requires one in production. */
  readonly userAgent?: string;
  /** Pad the request with garbage hashes to defeat traffic analysis. */
  readonly addPadding?: boolean;
}

export interface HibpChecker {
  check(plaintext: string): Promise<BreachedCredCheck>;
  /** Lower-level — useful for tests or when you only have a SHA-1. */
  checkSha1(sha1HexUpper: string): Promise<BreachedCredCheck>;
}

export function createHibpChecker(opts: HibpCheckerOptions = {}): HibpChecker {
  const baseUrl = opts.baseUrl ?? 'https://api.pwnedpasswords.com';
  const fetchCandidate =
    opts.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
  if (!fetchCandidate) {
    throw new Error(
      'createHibpChecker: no fetch implementation — pass `fetch` explicitly or run on Node 20+',
    );
  }
  const fetchImpl: FetchLike = fetchCandidate;
  const headers: Record<string, string> = {
    'Add-Padding': opts.addPadding ? 'true' : 'false',
    'User-Agent': opts.userAgent ?? 'borjie-security-hardening/0.1.0',
  };

  async function checkSha1(sha1HexUpper: string): Promise<BreachedCredCheck> {
    const prefix = sha1HexUpper.slice(0, 5);
    const suffix = sha1HexUpper.slice(5);
    const res = await fetchImpl(`${baseUrl}/range/${prefix}`, { headers });
    if (!res.ok) {
      return { breached: false, source: 'unknown' };
    }
    const body = await res.text();
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const [hashSuffix, countStr] = line.split(':');
      if (!hashSuffix || !countStr) continue;
      if (hashSuffix.toUpperCase() === suffix) {
        const count = parseInt(countStr, 10);
        return Number.isFinite(count)
          ? { breached: true, count, source: 'hibp' }
          : { breached: true, source: 'hibp' };
      }
    }
    return { breached: false, source: 'hibp' };
  }

  return {
    async check(plaintext) {
      const sha1 = createHash('sha1')
        .update(plaintext, 'utf8')
        .digest('hex')
        .toUpperCase();
      return checkSha1(sha1);
    },
    checkSha1,
  };
}
