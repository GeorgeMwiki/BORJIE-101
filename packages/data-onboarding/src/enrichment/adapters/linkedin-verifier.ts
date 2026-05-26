/**
 * LinkedIn verifier — finds a professional profile via search.
 *
 * Production: routes through @borjie/research-tools (Tavily / Exa).
 * Scaffold: deterministic fake that returns confirmation when the
 * `worker_name` is provided.
 */

import type { VerificationFinding } from '../../types.js';

export interface LinkedinVerifier {
  verify(args: {
    readonly worker_name: string;
    readonly employer_name?: string;
  }): Promise<VerificationFinding>;
}

export function createInMemoryLinkedinVerifier(): LinkedinVerifier {
  return Object.freeze({
    async verify(args: {
      readonly worker_name: string;
      readonly employer_name?: string;
    }): Promise<VerificationFinding> {
      const ok = args.worker_name.trim().length > 0;
      return Object.freeze({
        source: 'linkedin',
        confirmed: ok,
        details: ok
          ? Object.freeze({ profile_url: 'https://linkedin.com/in/example' })
          : Object.freeze({ reason: 'no_name_provided' }),
      });
    },
  });
}
