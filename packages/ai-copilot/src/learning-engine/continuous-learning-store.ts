/**
 * Continuous Learning Store — lifetime learning ledger per user.
 *
 * Append-only. In production this wraps a Postgres writer (see
 * migration 0061). In tests callers use InMemoryLearningLedger.
 *
 * Every row is (tenantId, userId, conceptId, event, ts, payload).
 * Tenant isolation enforced at the storage layer.
 */

export type LearningEvent =
  | 'concept-introduced'
  | 'concept-quizzed'
  | 'concept-mastered'
  | 'concept-lapsed'
  | 'micro-lesson-shown'
  | 'micro-lesson-completed'
  | 'journey-step-started'
  | 'journey-step-completed'
  | 'style-profile-updated';

export interface LearningLedgerRow {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly conceptId: string | null;
  readonly event: LearningEvent;
  readonly ts: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface LearningLedgerQuery {
  readonly tenantId: string;
  readonly userId?: string;
  readonly conceptId?: string;
  readonly event?: LearningEvent;
  readonly sinceTs?: string;
  readonly limit?: number;
}

export interface LearningLedgerStorage {
  append(row: LearningLedgerRow): Promise<void>;
  query(q: LearningLedgerQuery): Promise<readonly LearningLedgerRow[]>;
  countDistinctConcepts(tenantId: string, userId: string): Promise<number>;
}

export class InMemoryLearningLedger implements LearningLedgerStorage {
  private readonly rows: LearningLedgerRow[] = [];

  async append(row: LearningLedgerRow): Promise<void> {
    this.rows.push(row);
  }

  async query(q: LearningLedgerQuery): Promise<readonly LearningLedgerRow[]> {
    const filtered = this.rows.filter((r) => {
      if (r.tenantId !== q.tenantId) return false;
      if (q.userId && r.userId !== q.userId) return false;
      if (q.conceptId && r.conceptId !== q.conceptId) return false;
      if (q.event && r.event !== q.event) return false;
      if (q.sinceTs && r.ts < q.sinceTs) return false;
      return true;
    });
    const limit = q.limit ?? 1000;
    return filtered.slice(-limit);
  }

  async countDistinctConcepts(tenantId: string, userId: string): Promise<number> {
    const set = new Set<string>();
    for (const r of this.rows) {
      if (r.tenantId !== tenantId) continue;
      if (r.userId !== userId) continue;
      if (r.conceptId) set.add(r.conceptId);
    }
    return set.size;
  }
}

export class ContinuousLearningStore {
  constructor(private readonly storage: LearningLedgerStorage) {}

  async recordEvent(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly userId: string;
    readonly conceptId?: string;
    readonly event: LearningEvent;
    readonly ts: string;
    readonly payload?: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    const row: LearningLedgerRow = {
      id: input.id,
      tenantId: input.tenantId,
      userId: input.userId,
      conceptId: input.conceptId ?? null,
      event: input.event,
      ts: input.ts,
      payload: input.payload ?? {},
    };
    await this.storage.append(row);
  }

  async masteredConceptsCount(
    tenantId: string,
    userId: string,
  ): Promise<number> {
    const rows = await this.storage.query({
      tenantId,
      userId,
      event: 'concept-mastered',
    });
    const set = new Set(rows.map((r) => r.conceptId).filter(Boolean) as string[]);
    return set.size;
  }

  async lifetimeEventCount(
    tenantId: string,
    userId: string,
  ): Promise<number> {
    const rows = await this.storage.query({ tenantId, userId });
    return rows.length;
  }

  async history(
    tenantId: string,
    userId: string,
    limit = 100,
  ): Promise<readonly LearningLedgerRow[]> {
    return this.storage.query({ tenantId, userId, limit });
  }
}
