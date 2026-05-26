/**
 * In-memory `TacitExtractionRepository`.
 *
 * Wave HARVEST. Pure-memory adapter for tests + dev.
 */

import type {
  Extraction,
  TacitExtractionRepository,
} from '../types.js';

export function createInMemoryTacitExtractionRepository(): TacitExtractionRepository {
  const rows = new Map<string, Extraction>();

  function freeze(row: Extraction): Extraction {
    return Object.freeze({
      ...row,
      entity: Object.freeze({
        ...row.entity,
        structured: Object.freeze({ ...row.entity.structured }),
        citations: Object.freeze([...row.entity.citations]),
      }),
    });
  }

  return {
    async insert(row: Extraction): Promise<Extraction> {
      const frozen = freeze(row);
      rows.set(frozen.id, frozen);
      return frozen;
    },

    async read(id: string, tenantId: string): Promise<Extraction | null> {
      const row = rows.get(id);
      if (!row || row.tenantId !== tenantId) return null;
      return row;
    },

    async listForInterview(
      interviewId: string,
      tenantId: string,
    ): Promise<ReadonlyArray<Extraction>> {
      return Object.freeze(
        Array.from(rows.values()).filter(
          (r) => r.interviewId === interviewId && r.tenantId === tenantId,
        ),
      );
    },

    async setRedundantWith(
      id: string,
      tenantId: string,
      cellId: string,
    ): Promise<Extraction | null> {
      const existing = rows.get(id);
      if (!existing || existing.tenantId !== tenantId) return null;
      const next = freeze({
        ...existing,
        redundantWithCellId: cellId,
        novel: false,
      });
      rows.set(id, next);
      return next;
    },

    async setPersisted(
      id: string,
      tenantId: string,
      cellId: string,
    ): Promise<Extraction | null> {
      const existing = rows.get(id);
      if (!existing || existing.tenantId !== tenantId) return null;
      const next = freeze({
        ...existing,
        persistedCellId: cellId,
      });
      rows.set(id, next);
      return next;
    },
  };
}
