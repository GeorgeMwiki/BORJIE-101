/**
 * In-memory `TacitInterviewRepository`.
 *
 * Wave HARVEST. Pure-memory adapter for tests + dev. Production wires
 * a Drizzle-backed adapter on the `@borjie/database` package; this
 * adapter ships here so consumers can scaffold the engine without a
 * live Postgres.
 *
 * Immutability: every stored row is frozen on insert. Mutation
 * operations (turn append, status flip) replace the row outright.
 */

import type {
  Interview,
  InterviewStatus,
  TacitInterviewRepository,
  TranscriptTurn,
} from '../types.js';

interface InMemoryInterviewRepoDeps {
  /** Clock injection for deterministic testing. */
  readonly now: () => Date;
}

export function createInMemoryTacitInterviewRepository(
  deps: InMemoryInterviewRepoDeps = { now: () => new Date() },
): TacitInterviewRepository {
  const rows = new Map<string, Interview>();

  function freezeRow(row: Interview): Interview {
    return Object.freeze({
      ...row,
      transcript: Object.freeze([...row.transcript]),
    });
  }

  return {
    async insert(row: Interview): Promise<Interview> {
      const frozen = freezeRow(row);
      rows.set(frozen.id, frozen);
      return frozen;
    },

    async read(id: string, tenantId: string): Promise<Interview | null> {
      const row = rows.get(id);
      if (!row) return null;
      if (row.tenantId !== tenantId) return null;
      return row;
    },

    async appendTurn(
      id: string,
      tenantId: string,
      turn: TranscriptTurn,
    ): Promise<Interview | null> {
      const existing = rows.get(id);
      if (!existing || existing.tenantId !== tenantId) return null;
      const next: Interview = freezeRow({
        ...existing,
        transcript: [...existing.transcript, turn],
      });
      rows.set(id, next);
      return next;
    },

    async setStatus(
      id: string,
      tenantId: string,
      status: InterviewStatus,
      endedAt: string,
    ): Promise<Interview | null> {
      const existing = rows.get(id);
      if (!existing || existing.tenantId !== tenantId) return null;
      const _now = deps.now();
      void _now;
      const next: Interview = freezeRow({
        ...existing,
        status,
        endedAt,
      });
      rows.set(id, next);
      return next;
    },
  };
}
