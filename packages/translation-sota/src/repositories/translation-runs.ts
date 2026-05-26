/**
 * `translation_runs` repository.
 *
 * In-memory implementation. The Drizzle-backed adapter ships in the
 * database package (Wave 19I SQL-backed adapter, follow-up). Both
 * implementations conform to `TranslationRunRepository` from
 * `../types.ts`.
 *
 * Immutability: rows are frozen on insert and never mutated. The
 * per-tenant hash chain is computed deterministically off the
 * (op, payload) → chainHash() helper.
 */

import { randomUUID } from 'node:crypto';
import type {
  GlossaryEntry,
  CodeSwitchSegment,
  LanguageCode,
  ProviderId,
  TranslationResult,
  TranslationRunRepository,
} from '../types.js';
import {
  computeTranslationAuditHash,
  GENESIS_HASH,
} from '../audit/audit-chain-link.js';

export interface InMemoryTranslationRunRepoDeps {
  readonly now: () => Date;
}

export function createInMemoryTranslationRunRepository(
  deps: InMemoryTranslationRunRepoDeps = { now: () => new Date() },
): TranslationRunRepository {
  const rows = new Map<string, TranslationResult>();
  /** Per-tenant chain head — the last translation_runs row's auditHash. */
  const chainHead = new Map<string, string>();

  function head(tenantId: string): string {
    return chainHead.get(tenantId) ?? GENESIS_HASH;
  }

  return {
    async insert(input) {
      const id = randomUUID();
      const createdAt = deps.now();
      const prevHash = head(input.tenantId);
      const auditHash = computeTranslationAuditHash(
        {
          op: 'insert',
          tenantId: input.tenantId,
          sourceLang: input.sourceLang,
          targetLang: input.targetLang,
          provider: input.provider,
          sourceText: input.sourceText,
          targetText: input.targetText,
          createdAt: createdAt.toISOString(),
        },
        prevHash,
      );
      const row: TranslationResult = Object.freeze({
        tenantId: input.tenantId,
        runId: id,
        sourceLang: input.sourceLang as LanguageCode,
        targetLang: input.targetLang as LanguageCode,
        sourceText: input.sourceText,
        targetText: input.targetText,
        provider: input.provider as ProviderId,
        register: Object.freeze({ level: 'neutral', honorific: undefined }),
        glossaryTermsUsed: Object.freeze(
          input.glossaryTermsUsed.map(
            (e): GlossaryEntry => Object.freeze({ ...e }),
          ),
        ),
        codeSwitchSegments: Object.freeze(
          input.codeSwitchSegments.map(
            (s): CodeSwitchSegment => Object.freeze({ ...s }),
          ),
        ),
        bleu: input.bleu,
        chrf: input.chrf,
        terminologyAdherence: input.terminologyAdherence,
        latencyMs: input.latencyMs,
        costUsdCents: input.costUsdCents,
        auditHash,
        prevHash,
        createdAt,
        demotions: Object.freeze([]),
      });
      rows.set(id, row);
      chainHead.set(input.tenantId, auditHash);
      return Object.freeze({
        id,
        auditHash,
        prevHash,
        createdAt,
      });
    },

    async findById(tenantId, id) {
      const row = rows.get(id);
      if (row === undefined || row.tenantId !== tenantId) {
        return null;
      }
      return row;
    },

    async listRecentForTenant(tenantId, limit) {
      const filtered: TranslationResult[] = [];
      for (const row of rows.values()) {
        if (row.tenantId === tenantId) {
          filtered.push(row);
        }
      }
      filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return Object.freeze(filtered.slice(0, Math.max(0, limit)));
    },
  };
}
