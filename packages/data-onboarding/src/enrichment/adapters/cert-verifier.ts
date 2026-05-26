/**
 * Certification verifier — OSHA-equivalent professional certs.
 *
 * Production: hits the issuing authority's registry (e.g. TZ OHS,
 * IM4DC, ICMI). Scaffold: deterministic fake.
 */

import type { VerificationFinding } from '../../types.js';

export interface CertVerifier {
  verify(args: {
    readonly cert_id: string;
    readonly authority?: string;
  }): Promise<VerificationFinding>;
}

export function createInMemoryCertVerifier(): CertVerifier {
  return Object.freeze({
    async verify(args: {
      readonly cert_id: string;
      readonly authority?: string;
    }): Promise<VerificationFinding> {
      const ok = args.cert_id.trim().length >= 4;
      return Object.freeze({
        source: 'cert_registry',
        confirmed: ok,
        details: ok
          ? Object.freeze({
              authority: args.authority ?? 'unknown',
              status: 'active',
            })
          : Object.freeze({ reason: 'invalid_cert_id' }),
      });
    },
  });
}
