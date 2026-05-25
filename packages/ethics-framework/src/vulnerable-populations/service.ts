/**
 * Vulnerable populations service.
 *
 * `flagVulnerable()` appends a vulnerability record; `safeguardsFor()`
 * returns the safeguards derived from the latest flag and the
 * jurisdiction. Records are append-only so an auditor can reconstruct
 * the sequence of risk decisions.
 */

import type {
  EthicsStore,
  Jurisdiction,
  Safeguard,
  VulnerabilityFactor,
  VulnerabilityFlag,
} from '../types.js';
import { safeguardsFor } from './safeguard-rules.js';

export interface VulnerablePopulationsService {
  flagVulnerable(args: {
    subjectId: string;
    factors: ReadonlyArray<VulnerabilityFactor>;
    jurisdiction: Jurisdiction;
    evidenceSummary?: string;
  }): Promise<VulnerabilityFlag>;

  flagsFor(subjectId: string): Promise<ReadonlyArray<VulnerabilityFlag>>;

  /**
   * Returns the safeguards a subject is entitled to right now, given
   * their union of factors across all flags and the supplied
   * jurisdiction.
   */
  safeguardsFor(args: {
    subjectId: string;
    jurisdiction: Jurisdiction;
  }): Promise<ReadonlyArray<Safeguard>>;

  /**
   * Pure helper for callers that already have factors in hand and want
   * safeguards without touching the store.
   */
  getVulnerabilitySafeguards(args: {
    factors: ReadonlyArray<VulnerabilityFactor>;
    jurisdiction: Jurisdiction;
  }): ReadonlyArray<Safeguard>;
}

export interface VulnerablePopulationsServiceDeps {
  readonly store: EthicsStore;
  readonly now?: () => Date;
}

export function createVulnerablePopulationsService(
  deps: VulnerablePopulationsServiceDeps,
): VulnerablePopulationsService {
  const { store } = deps;
  function nowIso(): string {
    return (deps.now ? deps.now() : new Date()).toISOString();
  }

  return {
    async flagVulnerable({ subjectId, factors, jurisdiction, evidenceSummary }): Promise<VulnerabilityFlag> {
      if (factors.length === 0) {
        throw new Error('[ethics-framework/vulnerable] cannot flag with zero factors');
      }
      const flag: VulnerabilityFlag = {
        subjectId,
        factors,
        jurisdiction,
        flaggedAt: nowIso(),
        ...(evidenceSummary !== undefined ? { evidenceSummary } : {}),
      };
      await store.appendVulnerabilityFlag(flag);
      return flag;
    },

    async flagsFor(subjectId): Promise<ReadonlyArray<VulnerabilityFlag>> {
      return store.vulnerabilityFlags(subjectId);
    },

    async safeguardsFor({ subjectId, jurisdiction }): Promise<ReadonlyArray<Safeguard>> {
      const flags = await store.vulnerabilityFlags(subjectId);
      const factors = Array.from(new Set(flags.flatMap((f) => f.factors)));
      return safeguardsFor({ factors, jurisdiction });
    },

    getVulnerabilitySafeguards({ factors, jurisdiction }): ReadonlyArray<Safeguard> {
      return safeguardsFor({ factors, jurisdiction });
    },
  };
}

/** Pure helper export so callers don't need to instantiate the service. */
export { safeguardsFor as getVulnerabilitySafeguards } from './safeguard-rules.js';
