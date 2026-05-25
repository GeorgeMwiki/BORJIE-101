/**
 * Pattern extractor — Wave 28.
 *
 * Deterministic, rule-based. No LLM. Groups outcomes by
 * (domain, actionType), then for each context feature computes the
 * success-rate delta for each distinct value vs. the bucket baseline.
 *
 * Significance: a simple chi-squared approximation over the 2x2
 * contingency table (inGroup / notInGroup) × (success / notSuccess).
 * We flag a pattern as significant when chi-squared exceeds the 95%
 * critical value (df=1): 3.841.
 */

import {
  CHI_SQUARED_SIGNIFICANCE_95,
  type OutcomeEvent,
  type PatternEvidence,
} from './types.js';

export interface PatternExtractorOptions {
  /** Minimum observations in a (domain, actionType, feature, value) cell. */
  readonly minSampleSize?: number;
  /** Only inspect these features. If omitted, all non-object primitives are scanned. */
  readonly featureAllowlist?: readonly string[];
  readonly now?: () => Date;
}

const DEFAULT_MIN_SAMPLE_SIZE = 5;

interface Bucket {
  readonly key: string;
  readonly domain: OutcomeEvent['domain'];
  readonly actionType: string;
  readonly events: OutcomeEvent[];
}

function primitiveValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return null;
}

function collectFeatures(
  events: readonly OutcomeEvent[],
  allowlist?: readonly string[],
): readonly string[] {
  const keys = new Set<string>();
  for (const e of events) {
    for (const [k, v] of Object.entries(e.context)) {
      if (allowlist && !allowlist.includes(k)) continue;
      if (primitiveValue(v) !== null) keys.add(k);
    }
  }
  return Array.from(keys);
}

function isSuccess(outcome: OutcomeEvent): boolean {
  return outcome.outcome === 'success';
}

/**
 * Chi-squared statistic for a 2x2 contingency table:
 *
 *               success   non-success
 *   in-group      a           b
 *   out-group     c           d
 *
 *   chi² = (N * (ad - bc)²) / ((a+b)(c+d)(a+c)(b+d))
 */
function chiSquared2x2(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  if (n === 0) return 0;
  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const col2 = b + d;
  const denom = row1 * row2 * col1 * col2;
  if (denom === 0) return 0;
  const numerator = n * Math.pow(a * d - b * c, 2);
  return numerator / denom;
}

function hashId(parts: readonly string[]): string {
  // Deterministic, non-cryptographic. We only need a stable handle per
  // pattern so consumers can dedupe.
  const input = parts.join('|');
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return `pat_${Math.abs(hash).toString(36)}`;
}

export function extractPatterns(
  outcomes: readonly OutcomeEvent[],
  options: PatternExtractorOptions = {},
): readonly PatternEvidence[] {
  if (outcomes.length === 0) return [];
  const minSample = options.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE;
  const now = options.now ?? (() => new Date());
  const nowIso = now().toISOString();

  // Group by (domain, actionType).
  const buckets = new Map<string, Bucket>();
  for (const event of outcomes) {
    const key = `${event.domain}::${event.actionType}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.events.push(event);
    } else {
      buckets.set(key, {
        key,
        domain: event.domain,
        actionType: event.actionType,
        events: [event],
      });
    }
  }

  const results: PatternEvidence[] = [];

  for (const bucket of buckets.values()) {
    const bucketEvents = bucket.events.filter(
      (e) => e.outcome === 'success' || e.outcome === 'failure' || e.outcome === 'reverted',
    );
    if (bucketEvents.length < minSample) continue;

    const bucketSuccesses = bucketEvents.filter(isSuccess).length;
    const baselineSuccessRate = bucketSuccesses / bucketEvents.length;

    const features = collectFeatures(bucketEvents, options.featureAllowlist);

    for (const feature of features) {
      // Group events by value of this feature.
      const byValue = new Map<string, OutcomeEvent[]>();
      for (const event of bucketEvents) {
        const raw = event.context[feature];
        const value = primitiveValue(raw);
        if (value === null) continue;
        const existing = byValue.get(value);
        if (existing) existing.push(event);
        else byValue.set(value, [event]);
      }

      for (const [value, inGroup] of byValue.entries()) {
        if (inGroup.length < minSample) continue;
        const a = inGroup.filter(isSuccess).length;
        const b = inGroup.length - a;
        const outGroup = bucketEvents.filter(
          (e) => primitiveValue(e.context[feature]) !== value,
        );
        if (outGroup.length < minSample) continue;
        const c = outGroup.filter(isSuccess).length;
        const d = outGroup.length - c;

        const chi = chiSquared2x2(a, b, c, d);
        const successRate = a / inGroup.length;

        results.push({
          id: hashId([bucket.domain, bucket.actionType, feature, value]),
          domain: bucket.domain,
          actionType: bucket.actionType,
          contextFeature: feature,
          contextValue: value,
          sampleSize: inGroup.length,
          successRate,
          baselineSuccessRate,
          chiSquared: chi,
          significant: chi >= CHI_SQUARED_SIGNIFICANCE_95,
          discoveredAt: nowIso,
        });
      }
    }
  }

  // Order: significant first, then by chi-squared desc.
  return results
    .slice()
    .sort((a, b) => {
      if (a.significant !== b.significant) return a.significant ? -1 : 1;
      return b.chiSquared - a.chiSquared;
    });
}
