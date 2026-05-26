/**
 * Repository for `wave_revival_attempts` rows. One row per (wave_id,
 * attempt_number). Production uses Drizzle; tests + degraded mode use
 * the in-memory implementation.
 *
 * Per AGENT_SELF_REVIVAL_SPEC §10.
 */

import type { WaveRevivalAttempt } from '../types.js';

export interface RecordAttemptInput {
  readonly wave_id: string;
  readonly attempt_number: number;
  readonly original_dispatch_at: string;
  readonly crashed_at: string;
  readonly audit_hash: string;
}

export interface MarkOutcomeInput {
  readonly wave_id: string;
  readonly attempt_number: number;
  readonly resumed_at?: string;
  readonly completed_at?: string;
  readonly outcome: WaveRevivalAttempt['outcome'];
}

export interface AttemptsRepository {
  record(input: RecordAttemptInput): Promise<WaveRevivalAttempt>;
  markOutcome(input: MarkOutcomeInput): Promise<WaveRevivalAttempt | null>;
  listForWave(wave_id: string): Promise<ReadonlyArray<WaveRevivalAttempt>>;
}

export function createInMemoryAttemptsRepository(): AttemptsRepository & {
  readonly snapshot: () => ReadonlyArray<WaveRevivalAttempt>;
} {
  let rows: WaveRevivalAttempt[] = [];
  let idCounter = 0;

  function nextId(): string {
    idCounter += 1;
    return `wra_${idCounter.toString(36)}`;
  }

  return {
    snapshot() {
      return rows.slice();
    },
    async record(input) {
      const row: WaveRevivalAttempt = {
        id: nextId(),
        wave_id: input.wave_id,
        attempt_number: input.attempt_number,
        original_dispatch_at: input.original_dispatch_at,
        crashed_at: input.crashed_at,
        resumed_at: null,
        completed_at: null,
        outcome: null,
        audit_hash: input.audit_hash,
      };
      rows = [...rows, row];
      return row;
    },
    async markOutcome(input) {
      let updated: WaveRevivalAttempt | null = null;
      rows = rows.map((r) => {
        if (
          r.wave_id !== input.wave_id ||
          r.attempt_number !== input.attempt_number
        ) {
          return r;
        }
        const next: WaveRevivalAttempt = {
          ...r,
          resumed_at: input.resumed_at ?? r.resumed_at,
          completed_at: input.completed_at ?? r.completed_at,
          outcome: input.outcome,
        };
        updated = next;
        return next;
      });
      return updated;
    },
    async listForWave(wave_id) {
      return rows
        .filter((r) => r.wave_id === wave_id)
        .sort((a, b) => a.attempt_number - b.attempt_number);
    },
  };
}
