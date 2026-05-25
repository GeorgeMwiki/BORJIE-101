/**
 * Cohort signal — k-anonymous aggregate evidence the kernel mixes
 * into the system prompt as grounding. Tier-aware: lower tiers see
 * less-specific cohorts.
 *
 * The cohort source is injected; this module owns ONLY the rendering
 * + k-floor enforcement. It refuses to render any cohort whose
 * underlying k is below `awareness-scopes.cohortMinK(tier)`.
 */

import type { AwarenessTier } from './kernel-types.js';
import { cohortMinK } from './awareness-scopes.js';

export interface CohortFinding {
  readonly fingerprint: string;       // opaque slice id, used in citations
  readonly statistic: string;         // human-readable label
  readonly value: number;
  readonly unit: 'pct' | 'count' | 'currency-usd' | 'days';
  readonly k: number;                 // count of contributing entities
  readonly asOf: string;              // ISO-8601
}

export interface CohortSource {
  /** Pull up to N findings relevant to the message + tier. */
  findRelevant(args: {
    readonly userMessage: string;
    readonly tier: AwarenessTier;
    readonly limit: number;
  }): Promise<ReadonlyArray<CohortFinding>>;
}

export interface CohortMixin {
  readonly findings: ReadonlyArray<CohortFinding>;
  readonly promptFragment: string;     // empty string when no findings survived
  readonly fingerprints: ReadonlyArray<string>;
}

export async function buildCohortMixin(args: {
  readonly source: CohortSource;
  readonly tier: AwarenessTier;
  readonly userMessage: string;
  readonly limit?: number;
}): Promise<CohortMixin> {
  const minK = cohortMinK(args.tier);
  const raw = await args.source.findRelevant({
    userMessage: args.userMessage,
    tier: args.tier,
    limit: args.limit ?? 4,
  });
  const safe = raw.filter((f) => f.k >= minK);
  if (safe.length === 0) {
    return { findings: [], promptFragment: '', fingerprints: [] };
  }
  const lines = safe.map(
    (f) => `  - ${f.statistic}: ${formatValue(f.value, f.unit)} (k=${f.k}, as-of ${f.asOf})`,
  );
  const fragment = [
    'Cohort context (differentially-private aggregates; cite by fingerprint):',
    ...lines,
  ].join('\n');
  return {
    findings: safe,
    promptFragment: fragment,
    fingerprints: safe.map((f) => f.fingerprint),
  };
}

function formatValue(v: number, unit: CohortFinding['unit']): string {
  switch (unit) {
    case 'pct':           return `${(v * 100).toFixed(1)}%`;
    case 'count':         return v.toFixed(0);
    case 'currency-usd':  return `USD ${v.toFixed(2)}`;
    case 'days':          return `${v.toFixed(1)} days`;
  }
}
