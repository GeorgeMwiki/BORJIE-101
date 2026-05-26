/**
 * NSSF verifier — Tanzania Social Security Fund enrollment check.
 *
 * Production: hits the NSSF employer-portal API to verify a worker's
 * active enrollment + employer history. Scaffold: deterministic fake.
 */

import type { VerificationFinding } from '../../types.js';

export interface NssfVerifier {
  verify(args: {
    readonly nida: string;
    readonly worker_name?: string;
  }): Promise<VerificationFinding>;
}

export function createInMemoryNssfVerifier(): NssfVerifier {
  return Object.freeze({
    async verify(args: {
      readonly nida: string;
      readonly worker_name?: string;
    }): Promise<VerificationFinding> {
      const ok = args.nida.replace(/\D/g, '').length === 20;
      return Object.freeze({
        source: 'nssf',
        confirmed: ok,
        details: ok
          ? Object.freeze({ enrollment_status: 'active' })
          : Object.freeze({ reason: 'no_match' }),
      });
    },
  });
}
