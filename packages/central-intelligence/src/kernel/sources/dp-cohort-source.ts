/**
 * DP cohort source — adapter from `@borjie/graph-privacy`'s
 * DpAggregator into the kernel's CohortSource port. Lets the kernel
 * mix differentially-private cross-tenant statistics into the system
 * prompt as grounding evidence.
 *
 * The kernel's CohortSource takes a free-text userMessage; we map
 * keywords to a fixed catalogue of structured AggregateQuery values
 * so each statistic comes through a mathematically-calibrated DP
 * mechanism. Unmapped messages return zero findings — the kernel
 * simply omits the cohort fragment.
 *
 * graph-privacy is duck-typed locally so this package does not
 * compile-time-depend on it; the production composition root binds
 * a concrete DpAggregator at runtime.
 */

import type { CohortFinding, CohortSource } from '../cohort-signal.js';

// ─────────────────────────────────────────────────────────────────────
// Duck-typed DpAggregator surface — keep in sync with
// @borjie/graph-privacy/src/aggregators/dp-aggregator.
// ─────────────────────────────────────────────────────────────────────

export interface DpAggregateQuery {
  readonly statistic: string;
  readonly slice: {
    readonly jurisdictions: ReadonlyArray<string>;
    readonly propertyClasses: ReadonlyArray<string>;
    readonly from: string;
    readonly to: string;
  };
  readonly mechanism:
    | { readonly kind: 'laplace'; readonly epsilon: number; readonly sensitivity: number }
    | {
        readonly kind: 'gaussian';
        readonly epsilon: number;
        readonly delta: number;
        readonly sensitivity: number;
      };
  readonly kMin: number;
}

export interface DpPlatformAuthContext {
  readonly actorUserId: string;
  readonly actorRoles: ReadonlyArray<string>;
}

export interface DpAggregateOutcome {
  readonly kind: 'published' | 'refused';
  readonly statistic?: string;
  readonly noisedValue?: number;
  readonly contributingTenants?: number;
  readonly generatedAt?: string;
  readonly slice?: { readonly from: string; readonly to: string };
  readonly reason?: string;
}

export interface DpAggregator {
  aggregate(
    query: DpAggregateQuery,
    ctx: DpPlatformAuthContext,
  ): Promise<DpAggregateOutcome>;
}

// ─────────────────────────────────────────────────────────────────────
// Catalogue — keyword → query
// ─────────────────────────────────────────────────────────────────────

interface CataloguedQuery {
  readonly keywords: ReadonlyArray<RegExp>;
  readonly statistic: string;
  readonly label: string;
  readonly unit: CohortFinding['unit'];
  readonly mechanism: DpAggregateQuery['mechanism'];
}

const CATALOGUE: ReadonlyArray<CataloguedQuery> = [
  {
    keywords: [/\barrears?\b/i, /\blate\b/i, /\bdebt\b/i],
    statistic: 'arrears_rate',
    label: 'Platform arrears rate',
    unit: 'pct',
    mechanism: { kind: 'laplace', epsilon: 0.5, sensitivity: 0.05 },
  },
  {
    keywords: [/\bcollect\w+/i, /\brent collected\b/i],
    statistic: 'collection_rate',
    label: 'Platform on-time collection rate',
    unit: 'pct',
    mechanism: { kind: 'laplace', epsilon: 0.5, sensitivity: 0.05 },
  },
  {
    keywords: [/\bvacanc\w+/i, /\bempty unit\b/i],
    statistic: 'vacancy_days_mean',
    label: 'Mean vacancy days (platform)',
    unit: 'days',
    mechanism: { kind: 'laplace', epsilon: 0.5, sensitivity: 5 },
  },
  {
    keywords: [/\brenew\w+/i, /\blease end\b/i],
    statistic: 'renewal_rate',
    label: 'Platform lease renewal rate',
    unit: 'pct',
    mechanism: { kind: 'laplace', epsilon: 0.5, sensitivity: 0.05 },
  },
  {
    keywords: [/\bmaintenance\b/i, /\bwork[- ]?order\b/i, /\brepair\b/i],
    statistic: 'maintenance_ttc_mean',
    label: 'Mean maintenance time-to-complete (hours)',
    unit: 'count',
    mechanism: { kind: 'laplace', epsilon: 0.5, sensitivity: 4 },
  },
];

const DEFAULT_SLICE: DpAggregateQuery['slice'] = {
  jurisdictions: ['TZ', 'KE'],
  propertyClasses: [],
  // Default window: trailing 90 days. Production callers override.
  from: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
  to: new Date().toISOString(),
};

// ─────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────

export interface DpCohortSourceDeps {
  readonly aggregator: DpAggregator;
  readonly authContext: DpPlatformAuthContext;
  readonly slice?: DpAggregateQuery['slice'];
  readonly kMin?: number;
}

export function createDpCohortSource(deps: DpCohortSourceDeps): CohortSource {
  const slice = deps.slice ?? DEFAULT_SLICE;
  const kMin = deps.kMin ?? 5;

  return {
    async findRelevant({ userMessage, tier, limit }) {
      void tier;
      const matched = CATALOGUE.filter((q) =>
        q.keywords.some((re) => re.test(userMessage)),
      ).slice(0, limit);
      if (matched.length === 0) return [];

      const findings: CohortFinding[] = [];
      for (const q of matched) {
        try {
          const out = await deps.aggregator.aggregate(
            { statistic: q.statistic, slice, mechanism: q.mechanism, kMin },
            deps.authContext,
          );
          if (out.kind !== 'published' || out.noisedValue === undefined) continue;
          findings.push({
            fingerprint: `dp:${q.statistic}:${slice.from}:${slice.to}`,
            statistic: q.label,
            value: out.noisedValue,
            unit: q.unit,
            k: out.contributingTenants ?? kMin,
            asOf: out.generatedAt ?? new Date().toISOString(),
          });
        } catch {
          // Swallow per-query failure — a noisy aggregator must not break
          // the kernel's main thought path.
        }
      }
      return findings;
    },
  };
}
