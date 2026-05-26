/**
 * `translation_glossary_overrides` repository.
 *
 * In-memory implementation, conforms to `GlossaryOverrideRepository`.
 * Tenant-scoped; the UNIQUE constraint
 * (tenant_id, src_term, src_lang, target_lang, register) is honoured
 * by an upsert key. Rows are frozen on insert.
 */

import type {
  GlossaryEntry,
  GlossaryOverrideRepository,
  LanguageCode,
  RegisterLevel,
} from '../types.js';

interface StoredEntry extends GlossaryEntry {
  readonly tenantId: string;
}

function uniqueKey(input: {
  readonly tenantId: string;
  readonly srcTerm: string;
  readonly srcLang: LanguageCode;
  readonly targetLang: LanguageCode;
  readonly register: RegisterLevel;
}): string {
  return [
    input.tenantId,
    input.srcLang,
    input.targetLang,
    input.register,
    input.srcTerm.toLowerCase(),
  ].join('::');
}

export function createInMemoryGlossaryOverrideRepository(): GlossaryOverrideRepository {
  const rows = new Map<string, StoredEntry>();

  return {
    async upsert(entry) {
      const key = uniqueKey({
        tenantId: entry.tenantId,
        srcTerm: entry.srcTerm,
        srcLang: entry.srcLang,
        targetLang: entry.targetLang,
        register: entry.register,
      });
      rows.set(key, Object.freeze({ ...entry }));
    },

    async listForTenant(tenantId) {
      const entries: GlossaryEntry[] = [];
      for (const row of rows.values()) {
        if (row.tenantId === tenantId) {
          entries.push(
            Object.freeze({
              srcTerm: row.srcTerm,
              srcLang: row.srcLang,
              targetTerm: row.targetTerm,
              targetLang: row.targetLang,
              domain: row.domain,
              register: row.register,
              ...(row.sourceUrl !== undefined
                ? { sourceUrl: row.sourceUrl }
                : {}),
              ...(row.brand !== undefined ? { brand: row.brand } : {}),
            }),
          );
        }
      }
      return Object.freeze(entries);
    },

    async delete(input) {
      const key = uniqueKey(input);
      rows.delete(key);
    },
  };
}
