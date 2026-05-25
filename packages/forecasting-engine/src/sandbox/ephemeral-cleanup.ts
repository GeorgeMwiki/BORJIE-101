/**
 * EphemeralCleanup — TTL-based registry for active sandboxes.
 *
 * The orchestrator registers each sandbox here at create time and
 * `sweep()` enumerates the ones whose TTL has expired. Real
 * disposal (dropping schemas, freeing memory) is performed by the
 * sandbox itself; this module only tracks the bookkeeping.
 */

import { logger } from '../logger.js';
interface RegistryEntry {
  readonly runId: string;
  readonly createdAtMs: number;
  readonly ttlMs: number;
  readonly dispose: () => Promise<void>;
}

export class EphemeralCleanup {
  private entries: ReadonlyMap<string, RegistryEntry> = new Map();

  register(entry: RegistryEntry): void {
    const next = new Map(this.entries);
    next.set(entry.runId, entry);
    this.entries = next;
  }

  unregister(runId: string): void {
    const next = new Map(this.entries);
    next.delete(runId);
    this.entries = next;
  }

  async sweep(nowMs: number = Date.now()): Promise<ReadonlyArray<string>> {
    const expired: string[] = [];
    for (const e of this.entries.values()) {
      if (nowMs - e.createdAtMs >= e.ttlMs) {
        try {
          await e.dispose();
          expired.push(e.runId);
        } catch (err) {
          logger.error('Sandbox dispose failed', { runId: e.runId, err });
          throw new Error(
            `Failed to dispose expired sandbox ${e.runId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
    expired.forEach((id) => this.unregister(id));
    return expired;
  }

  size(): number {
    return this.entries.size;
  }
}
