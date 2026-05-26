/**
 * NIDA verifier — Tanzania National Identification Authority lookup.
 *
 * The package is I/O-free at scaffold time; this module ships the
 * adapter interface plus an in-memory deterministic fake for tests.
 * Production wiring will plug in an HTTP client that hits the NIDA
 * public verification endpoint (rate-limited; subject to commercial
 * data-sharing agreement).
 */

import type { VerificationFinding } from '../../types.js';

export interface NidaLookupResult {
  readonly nida: string;
  readonly confirmed: boolean;
  readonly full_name?: string;
  readonly dob_iso?: string;
}

export interface NidaVerifier {
  verify(nida: string): Promise<VerificationFinding>;
}

/**
 * Deterministic in-memory verifier. Confirms any NIDA whose length is
 * exactly 20 digits; refuses everything else. Useful for tests.
 */
export function createInMemoryNidaVerifier(): NidaVerifier {
  return Object.freeze({
    async verify(nida: string): Promise<VerificationFinding> {
      const digits_only = nida.replace(/\D/g, '');
      const ok = digits_only.length === 20;
      return Object.freeze({
        source: 'nida',
        confirmed: ok,
        details: ok
          ? Object.freeze({ nida_digits: digits_only })
          : Object.freeze({ reason: 'invalid_format' }),
      });
    },
  });
}
