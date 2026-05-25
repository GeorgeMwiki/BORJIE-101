/**
 * Per-tenant LoRA registry — pure interface.
 *
 * Tenant LoRA TRAINING is offline: 15–30 reference images uploaded to a
 * Replicate trainer (e.g. `ostris/flux-dev-lora-trainer`) produce a
 * `lora_id` we persist on the tenant row. This module exposes:
 *
 *   1. The `LoraRecord` shape stored per tenant.
 *   2. The `LoraRegistry` port any persistence layer (postgres, kv,
 *      in-memory tests) implements.
 *   3. `createInMemoryLoraRegistry()` — a zero-dependency adapter useful
 *      for tests, sandboxes, and the demo seed.
 *
 * Reference:
 *   - Research: .audit/litfin-sota-2026-05-23/14-multimodal-generative.md (§1.11)
 *
 * No mutation of inputs; immutable record stewardship throughout.
 */

export interface LoraRecord {
  readonly loraId: string;
  readonly tenantId: string;
  readonly version: number;
  readonly status: 'training' | 'staged' | 'promoted' | 'retired';
  readonly baseModel: 'flux' | 'sdxl' | 'sd-3.5';
  readonly trainedAtIso: string;
  readonly notes?: string;
}

export interface LoraRegistry {
  register(record: LoraRecord): Promise<LoraRecord>;
  listForTenant(tenantId: string): Promise<ReadonlyArray<LoraRecord>>;
  promote(loraId: string): Promise<LoraRecord>;
  retire(loraId: string): Promise<LoraRecord>;
  getPromoted(tenantId: string): Promise<LoraRecord | null>;
}

export function createInMemoryLoraRegistry(): LoraRegistry {
  // Internal store is replaced on every mutation — never mutated in place.
  let store: ReadonlyArray<LoraRecord> = [];

  async function register(record: LoraRecord): Promise<LoraRecord> {
    if (store.some((r) => r.loraId === record.loraId)) {
      throw new Error(`LoRA already registered: ${record.loraId}`);
    }
    store = [...store, record];
    return record;
  }

  async function listForTenant(tenantId: string) {
    return store.filter((r) => r.tenantId === tenantId);
  }

  async function promote(loraId: string): Promise<LoraRecord> {
    const target = store.find((r) => r.loraId === loraId);
    if (!target) throw new Error(`LoRA not found: ${loraId}`);
    // Demote any other "promoted" record for the same tenant.
    const next: LoraRecord[] = store.map((r) => {
      if (r.tenantId !== target.tenantId) return r;
      if (r.loraId === loraId) return { ...r, status: 'promoted' };
      if (r.status === 'promoted') return { ...r, status: 'retired' };
      return r;
    });
    store = next;
    const found = next.find((r) => r.loraId === loraId);
    if (!found) throw new Error(`LoRA disappeared during promote: ${loraId}`);
    return found;
  }

  async function retire(loraId: string): Promise<LoraRecord> {
    const target = store.find((r) => r.loraId === loraId);
    if (!target) throw new Error(`LoRA not found: ${loraId}`);
    const updated: LoraRecord = { ...target, status: 'retired' };
    store = store.map((r) => (r.loraId === loraId ? updated : r));
    return updated;
  }

  async function getPromoted(tenantId: string): Promise<LoraRecord | null> {
    const found = store.find((r) => r.tenantId === tenantId && r.status === 'promoted');
    return found ?? null;
  }

  return { register, listForTenant, promote, retire, getPromoted };
}
