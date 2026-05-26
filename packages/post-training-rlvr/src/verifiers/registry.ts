/**
 * Verifier registry — `VerifierRegistry` interface + in-memory impl.
 *
 * The registry is a *set* of verifiers, addressable by name. The
 * `register()` operation creates a new registry (immutable);
 * `verifyAll(trace)` invokes every verifier whose `applies(trace)`
 * returns true and returns the per-verifier `VerificationResult[]`.
 *
 * Errors inside a verifier are converted to a `skip` verdict with
 * `error` in `evidence`. This mirrors the RewardBench discipline:
 * a verifier outage must not corrupt the reward signal.
 */

import type { RlvrTrace, Verifier, VerificationResult } from '../types.js';

export interface VerifierRegistry {
  readonly verifiers: ReadonlyArray<Verifier>;
  register(verifier: Verifier): VerifierRegistry;
  get(name: string): Verifier | undefined;
  verifyAll(trace: RlvrTrace): Promise<ReadonlyArray<VerificationResult>>;
}

const skipResult = (
  name: string,
  reason: string,
  evidence: Readonly<Record<string, unknown>> = {},
): VerificationResult =>
  Object.freeze({
    verifierName: name,
    verdict: 'skip' as const,
    reward: 0,
    evidence: Object.freeze({ reason, ...evidence }),
    confidence: 0,
  });

const errorResult = (
  name: string,
  err: unknown,
): VerificationResult => {
  const message = err instanceof Error ? err.message : String(err);
  return Object.freeze({
    verifierName: name,
    verdict: 'skip' as const,
    reward: 0,
    evidence: Object.freeze({ error: message }),
    confidence: 0,
  });
};

/**
 * Construct an in-memory registry. Each `register` call returns a new
 * registry; the underlying verifier list is frozen.
 */
export function createVerifierRegistry(
  initial: ReadonlyArray<Verifier> = [],
): VerifierRegistry {
  const verifiers: ReadonlyArray<Verifier> = Object.freeze([...initial]);

  return {
    verifiers,

    register(verifier: Verifier): VerifierRegistry {
      if (verifiers.some((v) => v.name === verifier.name)) {
        throw new Error(
          `Verifier already registered: ${verifier.name}`,
        );
      }
      return createVerifierRegistry([...verifiers, verifier]);
    },

    get(name: string): Verifier | undefined {
      return verifiers.find((v) => v.name === name);
    },

    async verifyAll(
      trace: RlvrTrace,
    ): Promise<ReadonlyArray<VerificationResult>> {
      const results: VerificationResult[] = [];
      for (const verifier of verifiers) {
        if (!verifier.applies(trace)) {
          results.push(
            skipResult(verifier.name, 'verifier_not_applicable'),
          );
          continue;
        }
        try {
          const result = await verifier.verify(trace);
          results.push(result);
        } catch (err) {
          results.push(errorResult(verifier.name, err));
        }
      }
      return Object.freeze(results);
    },
  };
}
