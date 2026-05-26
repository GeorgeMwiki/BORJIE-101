/**
 * Provider quality tracker.
 *
 * Persists periodic (provider, language) WER + PER + MOS samples into
 * the `language_provider_quality` table via the injected repository.
 * The router reads the latest sample per tuple at request time to
 * pick the best-quality provider for the desired pair.
 *
 * Drift detection (the 2σ trip referenced in §6 of the spec) lives in
 * the 19K self-improvement wave; this module just persists raw rows.
 */

import type {
  Language,
  ProviderQuality,
  ProviderQualityRepository,
  RecordProviderQualityInput,
} from '../types.js';

export interface QualityTrackerDeps {
  readonly repository: ProviderQualityRepository;
}

export interface QualityTracker {
  /** Persist a fresh quality sample. */
  record(input: RecordProviderQualityInput): Promise<ProviderQuality>;
  /** Latest sample for the (tenant, provider, lang) tuple. */
  latest(
    tenantId: string,
    provider: string,
    lang: Language,
  ): Promise<ProviderQuality | null>;
  /** Best (lowest WER, then highest MOS) provider for a language. */
  rankForLanguage(
    tenantId: string,
    lang: Language,
  ): Promise<ReadonlyArray<ProviderQuality>>;
}

export function createQualityTracker(deps: QualityTrackerDeps): QualityTracker {
  return {
    record(input) {
      return deps.repository.record(input);
    },

    latest(tenantId, provider, lang) {
      return deps.repository.findLatest(tenantId, provider, lang);
    },

    async rankForLanguage(tenantId, lang) {
      const rows = await deps.repository.listForLanguage(tenantId, lang);
      // Pick the latest sample per provider, then sort by WER asc, MOS desc.
      const latest = new Map<string, ProviderQuality>();
      for (const r of rows) {
        const prior = latest.get(r.provider);
        if (prior === undefined || r.measuredAt > prior.measuredAt) {
          latest.set(r.provider, r);
        }
      }
      const list = [...latest.values()];
      list.sort((a, b) => {
        if (a.wer !== b.wer) return a.wer - b.wer;
        return b.mos - a.mos;
      });
      return Object.freeze(list);
    },
  };
}
