/**
 * Repository for `wave_progress` rows.
 *
 * Defines the interface used by the detector + decider + watcher and
 * ships an in-memory implementation that powers tests + the degraded-
 * mode runtime (when DATABASE_URL is missing). Production wires a
 * Drizzle-backed adapter via the composition root.
 *
 * Per AGENT_SELF_REVIVAL_SPEC §10 — table shape lives in migration
 * 0029_wave_resilience.sql.
 */

import type { WaveProgressEntry, WaveStatus } from '../types.js';

export interface AppendProgressInput {
  readonly wave_id: string;
  readonly agent_id: string;
  readonly tenant_id?: string | null;
  readonly status: WaveStatus;
  readonly checkpoint_label?: string | null;
  readonly checkpoint_payload?: Record<string, unknown> | null;
  readonly attempt_number?: number;
  readonly now?: () => Date;
  readonly audit_hash: string;
}

export interface ProgressRepository {
  /** Append a new progress entry. Returns the persisted row. */
  append(input: AppendProgressInput): Promise<WaveProgressEntry>;
  /** Latest row per wave_id, ordered most-recent-first. */
  listLatestPerWave(): Promise<ReadonlyArray<WaveProgressEntry>>;
  /** All rows for a wave_id, oldest first. */
  listForWave(wave_id: string): Promise<ReadonlyArray<WaveProgressEntry>>;
  /** Rows in a given status, ordered by heartbeat ascending. */
  listByStatus(status: WaveStatus): Promise<ReadonlyArray<WaveProgressEntry>>;
}

interface InMemoryRecord {
  readonly entry: WaveProgressEntry;
  readonly seq: number;
}

/**
 * In-memory implementation — used by tests + degraded mode. Preserves
 * monotonic `checkpoint_seq` per wave_id.
 */
export function createInMemoryProgressRepository(): ProgressRepository & {
  readonly snapshot: () => ReadonlyArray<WaveProgressEntry>;
} {
  const rows: InMemoryRecord[] = [];
  const seqByWave = new Map<string, number>();
  let idCounter = 0;

  function nextId(): string {
    idCounter += 1;
    return `wp_${idCounter.toString(36)}`;
  }

  function nextSeq(wave_id: string): number {
    const current = seqByWave.get(wave_id) ?? 0;
    const next = current + 1;
    seqByWave.set(wave_id, next);
    return next;
  }

  return {
    snapshot() {
      return rows.map((r) => r.entry);
    },
    async append(input) {
      const now = (input.now ?? (() => new Date()))().toISOString();
      const seq = nextSeq(input.wave_id);
      const entry: WaveProgressEntry = {
        id: nextId(),
        wave_id: input.wave_id,
        agent_id: input.agent_id,
        tenant_id: input.tenant_id ?? null,
        status: input.status,
        checkpoint_seq: seq,
        checkpoint_label: input.checkpoint_label ?? null,
        checkpoint_payload: input.checkpoint_payload ?? null,
        heartbeat_at: now,
        attempt_number: input.attempt_number ?? 1,
        created_at: now,
        audit_hash: input.audit_hash,
      };
      rows.push({ entry, seq });
      return entry;
    },
    async listLatestPerWave() {
      const latest = new Map<string, WaveProgressEntry>();
      for (const r of rows) {
        const current = latest.get(r.entry.wave_id);
        if (!current || current.checkpoint_seq < r.entry.checkpoint_seq) {
          latest.set(r.entry.wave_id, r.entry);
        }
      }
      return Array.from(latest.values()).sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      );
    },
    async listForWave(wave_id) {
      return rows
        .filter((r) => r.entry.wave_id === wave_id)
        .sort((a, b) => a.entry.checkpoint_seq - b.entry.checkpoint_seq)
        .map((r) => r.entry);
    },
    async listByStatus(status) {
      const latest = await this.listLatestPerWave();
      return latest
        .filter((e) => e.status === status)
        .sort((a, b) => a.heartbeat_at.localeCompare(b.heartbeat_at));
    },
  };
}
