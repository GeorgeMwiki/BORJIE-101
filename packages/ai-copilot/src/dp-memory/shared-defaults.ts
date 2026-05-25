/**
 * shared-defaults.ts — DP-protected industry-default publisher.
 *
 * The cross-tenant query surface speaks in two modes:
 *   1. Ad-hoc benchmark queries (see `cross-tenant-query.ts`) — every
 *      call debits the caller's privacy budget.
 *   2. Published shared defaults — precomputed, DP-noised values with a
 *      TTL, so common look-ups (e.g. "average days-on-market for a 2BR
 *      in Westlands") do not burn budget per request.
 *
 * This module covers (2). `publishDefault` takes a key + an aggregate
 * query fn + an ε budget + TTL, runs the aggregate through the Laplace
 * mechanism, and writes the result to a swappable repository. The
 * publishing tenant pays the ε (it is effectively the platform operator,
 * not a customer tenant, but we still bookkeep the spend).
 */

import {
  addLaplaceNoise,
  laplaceConfidenceInterval,
  type RandomSource,
} from './differential-privacy.js';
import type {
  AggregatedPattern,
  SharedDefault,
  SharedDefaultRepository,
  FilterSpec,
} from './types.js';

export interface SharedDefaultsServiceConfig {
  readonly repository?: SharedDefaultRepository;
  readonly now?: () => Date;
  readonly rng?: RandomSource;
}

/**
 * Default TTL for a shared default: 30 days. Values older than this are
 * treated as stale and `lookupDefault` refuses to return them.
 */
export const DEFAULT_SHARED_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * In-memory repository used in degraded mode + tests. Keyed on
 * (key, jurisdiction ?? '*').
 */
export class InMemorySharedDefaultRepository implements SharedDefaultRepository {
  private readonly store = new Map<string, SharedDefault>();

  async read(key: string, jurisdiction?: string): Promise<SharedDefault | null> {
    const found = this.store.get(indexKey(key, jurisdiction));
    return found ? { ...found } : null;
  }

  async write(record: SharedDefault): Promise<void> {
    this.store.set(indexKey(record.key, record.jurisdiction), { ...record });
  }

  async list(): Promise<readonly SharedDefault[]> {
    return Array.from(this.store.values()).map((r) => ({ ...r }));
  }
}

export interface PublishDefaultInput {
  readonly key: string;
  readonly unit: string;
  readonly aggregate: AggregatedPattern;
  readonly epsilon: number;
  readonly sensitivity: number;
  readonly ttlMs?: number;
  readonly jurisdiction?: string;
}

export class SharedDefaultsService {
  private readonly repository: SharedDefaultRepository;
  private readonly now: () => Date;
  private readonly rng: RandomSource;

  constructor(config: SharedDefaultsServiceConfig = {}) {
    this.repository = config.repository ?? new InMemorySharedDefaultRepository();
    this.now = config.now ?? (() => new Date());
    this.rng = config.rng ?? Math.random;
  }

  /**
   * Publish a DP-protected shared default. `aggregate.value` is the
   * true (non-noisy) cross-tenant average; we apply Laplace noise
   * calibrated to `(sensitivity, epsilon)` and write the noisy value.
   *
   * Throws if the aggregate has zero sample size — we refuse to publish
   * a default that is backed by nothing.
   */
  async publishDefault(input: PublishDefaultInput): Promise<SharedDefault> {
    if (!input.key) throw new Error('key is required');
    if (!input.unit) throw new Error('unit is required');
    if (input.aggregate.sampleSize <= 0) {
      throw new Error('refusing to publish a default with sampleSize <= 0');
    }
    if (input.epsilon <= 0) throw new Error('epsilon must be > 0');
    if (input.sensitivity <= 0) throw new Error('sensitivity must be > 0');
    const nowIso = this.now().toISOString();
    const ttl = input.ttlMs ?? DEFAULT_SHARED_DEFAULT_TTL_MS;
    const noisy = addLaplaceNoise(
      input.aggregate.value,
      input.sensitivity,
      input.epsilon,
      this.rng,
    );
    const record: SharedDefault = {
      key: input.key,
      value: noisy,
      unit: input.unit,
      jurisdiction: input.jurisdiction ?? input.aggregate.filters.jurisdiction,
      sampleSize: input.aggregate.sampleSize,
      epsilonUsed: input.epsilon,
      generatedAt: nowIso,
      expiresAt: new Date(this.now().getTime() + ttl).toISOString(),
    };
    await this.repository.write(record);
    return record;
  }

  /**
   * Fetch a shared default. Returns `null` when missing or expired.
   */
  async lookupDefault(key: string, jurisdiction?: string): Promise<SharedDefault | null> {
    const found = await this.repository.read(key, jurisdiction);
    if (!found) return null;
    if (new Date(found.expiresAt).getTime() <= this.now().getTime()) return null;
    return found;
  }

  /**
   * Confidence interval for a previously-published default, assuming
   * Laplace mechanism. Useful when rendering the value next to a CI in
   * the UI.
   */
  confidenceFor(
    value: number,
    sensitivity: number,
    epsilon: number,
    confidence = 0.95,
  ): readonly [number, number] {
    return laplaceConfidenceInterval(value, sensitivity, epsilon, confidence);
  }

  async list(): Promise<readonly SharedDefault[]> {
    return this.repository.list();
  }
}

// Convenience: derive the jurisdiction from a FilterSpec if the caller
// did not explicitly pass one to `publishDefault`.
export function deriveJurisdiction(filters: FilterSpec | undefined): string | undefined {
  return filters?.jurisdiction;
}

function indexKey(key: string, jurisdiction?: string): string {
  return `${key}::${jurisdiction ?? '*'}`;
}
