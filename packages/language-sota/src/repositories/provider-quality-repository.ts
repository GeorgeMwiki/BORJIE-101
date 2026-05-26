/**
 * `language_provider_quality` repository.
 *
 * In-memory implementation. The SQL adapter for the table created by
 * migration 0048 ships from the host application's database package.
 * Both conform to `ProviderQualityRepository` from `../types.ts`.
 */

import { randomUUID } from 'node:crypto';

import {
  type ClockPort,
  type Language,
  type ProviderQuality,
  type ProviderQualityRepository,
  type RecordProviderQualityInput,
} from '../types.js';
import {
  GENESIS_HASH,
  computeProviderQualityAuditHash,
} from '../audit/audit-chain-link.js';

export interface InMemoryProviderQualityRepoDeps {
  readonly clock?: ClockPort;
}

export function createInMemoryProviderQualityRepository(
  deps: InMemoryProviderQualityRepoDeps = {},
): ProviderQualityRepository {
  const clock: ClockPort = deps.clock ?? { now: () => new Date() };
  const rows = new Map<string, ProviderQuality>();
  /** Per-(tenant, provider, lang) chain head. */
  const chainHeads = new Map<string, string>();

  function chainKey(
    tenantId: string,
    provider: string,
    lang: Language,
  ): string {
    return `${tenantId}|${provider}|${lang}`;
  }

  return {
    async record(input) {
      const id = randomUUID();
      const measuredAt = clock.now();
      const headKey = chainKey(input.tenantId, input.provider, input.lang);
      const prevHash = chainHeads.get(headKey) ?? GENESIS_HASH;
      const auditHash = computeProviderQualityAuditHash(
        {
          tenantId: input.tenantId,
          provider: input.provider,
          lang: input.lang,
          wer: input.wer,
          per: input.per,
          mos: input.mos,
          sampleN: input.sampleN,
          measuredAtIso: measuredAt.toISOString(),
        },
        prevHash,
      );
      const row: ProviderQuality = Object.freeze({
        id,
        tenantId: input.tenantId,
        provider: input.provider,
        lang: input.lang,
        wer: input.wer,
        per: input.per,
        mos: input.mos,
        measuredAt,
        sampleN: input.sampleN,
        auditHash,
      });
      rows.set(id, row);
      chainHeads.set(headKey, auditHash);
      return row;
    },

    async findLatest(tenantId, provider, lang) {
      let latest: ProviderQuality | null = null;
      for (const r of rows.values()) {
        if (
          r.tenantId === tenantId &&
          r.provider === provider &&
          r.lang === lang &&
          (latest === null || r.measuredAt > latest.measuredAt)
        ) {
          latest = r;
        }
      }
      return latest;
    },

    async listForLanguage(tenantId, lang) {
      const filtered: ProviderQuality[] = [];
      for (const r of rows.values()) {
        if (r.tenantId === tenantId && r.lang === lang) {
          filtered.push(r);
        }
      }
      filtered.sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime());
      return Object.freeze(filtered);
    },
  };
}

// =============================================================================
// SQL adapter shape (documentation only — Drizzle binding lives in the
// host database package).
// =============================================================================

export interface ProviderQualitySqlRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly provider: string;
  readonly lang: string;
  readonly wer: number;
  readonly per: number;
  readonly mos: number;
  readonly measured_at: Date;
  readonly sample_n: number;
  readonly audit_hash: string;
}

/**
 * Type-narrow a quality sample input. Useful at HTTP boundaries.
 */
export function isRecordProviderQualityInput(
  v: unknown,
): v is RecordProviderQualityInput {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.tenantId === 'string' &&
    typeof c.provider === 'string' &&
    typeof c.lang === 'string' &&
    typeof c.wer === 'number' &&
    typeof c.per === 'number' &&
    typeof c.mos === 'number' &&
    typeof c.sampleN === 'number'
  );
}
