/**
 * In-memory adapter for the routing-override port.
 *
 * Used in tests + standalone bootstrap. Production wires a Drizzle
 * adapter against the `llm_routing_overrides` table (follow-up).
 */

import type { OverridePort } from './override-port.js';
import type { RoutingOverrideEntry } from './schema.js';

function keyOf(tenantId: string, taskCategory: string): string {
  return `${tenantId}::${taskCategory}`;
}

export class InMemoryOverrideAdapter implements OverridePort {
  private readonly store = new Map<string, RoutingOverrideEntry>();

  async listForTenant(
    tenantId: string,
  ): Promise<ReadonlyArray<RoutingOverrideEntry>> {
    const out: RoutingOverrideEntry[] = [];
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId) out.push(entry);
    }
    return out;
  }

  async upsert(entry: RoutingOverrideEntry): Promise<void> {
    this.store.set(keyOf(entry.tenantId, entry.taskCategory), entry);
  }

  async delete(tenantId: string, taskCategory: string): Promise<boolean> {
    return this.store.delete(keyOf(tenantId, taskCategory));
  }

  /** Test hook. */
  clear(): void {
    this.store.clear();
  }
}
