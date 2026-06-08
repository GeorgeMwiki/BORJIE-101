/**
 * In-memory situational-model store — the Fast-Loop fallback when no database
 * / blackboard handle is present, and the reference adapter every test uses.
 *
 * Process-local + volatile (lost on restart) — exactly like
 * `createInMemoryNudgeDedupe` / the memory-v2 in-memory stores. A durable
 * adapter (blackboard slot / Drizzle) is selected at the composition root when
 * a handle is available; this adapter keeps the organ usable with zero infra.
 *
 * All writes route through the pure `mergeObservation` fold so the ACT-R
 * reference series is preserved across observations.
 */

import type {
  RecordEntityInput,
  SituationalModelStore,
  SituationEntity,
  SituationEntityKey,
} from './types.js';
import { entityKeyOf } from './types.js';
import { mergeObservation, parseRecordInput } from './merge.js';

export interface InMemorySituationalStoreDeps {
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  readonly now?: () => number;
}

export function createInMemorySituationalModelStore(
  deps: InMemorySituationalStoreDeps = {},
): SituationalModelStore {
  const now = deps.now ?? (() => Date.now());
  // tenantId → (entityKey → entity). Nested map keeps tenant isolation
  // structural — a tenant can never read another tenant's rows.
  const byTenant = new Map<string, Map<SituationEntityKey, SituationEntity>>();

  function tenantMap(
    tenantId: string,
  ): Map<SituationEntityKey, SituationEntity> {
    let m = byTenant.get(tenantId);
    if (!m) {
      m = new Map<SituationEntityKey, SituationEntity>();
      byTenant.set(tenantId, m);
    }
    return m;
  }

  return {
    async get(
      tenantId: string,
      key: SituationEntityKey,
    ): Promise<SituationEntity | null> {
      return byTenant.get(tenantId)?.get(key) ?? null;
    },

    async record(input: RecordEntityInput): Promise<SituationEntity> {
      parseRecordInput(input);
      const m = tenantMap(input.tenantId);
      const key = entityKeyOf(input.kind, input.entityId);
      const prev = m.get(key) ?? null;
      const merged = mergeObservation(prev, input, now());
      m.set(key, merged);
      return merged;
    },

    async list(tenantId: string): Promise<ReadonlyArray<SituationEntity>> {
      return Array.from(byTenant.get(tenantId)?.values() ?? []);
    },

    async remove(tenantId: string, key: SituationEntityKey): Promise<void> {
      byTenant.get(tenantId)?.delete(key);
    },
  };
}
