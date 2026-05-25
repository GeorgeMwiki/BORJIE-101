/**
 * Cost Persistence — tenant-scoped usage ledger for MCP calls.
 *
 * Every MCP tool invocation flows through `queueCostEntry` which batches
 * entries into the injected `CostLedgerPort`. In production the gateway
 * wires this to the Wave-10 AI cost ledger in `@borjie/ai-copilot`
 * (whose `recordUsage()` writes to `ai_cost_entries`). In tests we use
 * an in-memory implementation.
 *
 * Design:
 *   - batch to reduce DB pressure (10 entries OR 30s)
 *   - flush never throws — a failing flush returns entries to the queue
 *     for the next attempt
 *   - snapshot() aggregates by tenant
 */

import type {
  CostLedgerPort,
  McpCostEntry,
  McpCostSnapshot,
  McpTier,
} from './types.js';

// ============================================================================
// In-memory ledger (used by tests AND as a safe default in boot sequence
// before the real gateway service registry is ready).
// ============================================================================

export function createInMemoryCostLedger(): CostLedgerPort {
  let entries: ReadonlyArray<McpCostEntry> = [];

  return {
    async record(entry) {
      entries = [...entries, entry];
    },
    async snapshot(tenantId) {
      const now = new Date();
      const periodStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      ).toISOString();
      const periodEnd = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
      ).toISOString();

      const scoped = entries.filter((e) => e.tenantId === tenantId);
      const costByTool: Record<string, number> = {};
      const costByTier: Record<McpTier, number> = {
        standard: 0,
        pro: 0,
        enterprise: 0,
      };
      let totalCostUsdMicro = 0;
      let freeCallCount = 0;
      let paidCallCount = 0;

      for (const entry of scoped) {
        totalCostUsdMicro += entry.estimatedCostUsdMicro;
        if (entry.wasFree) freeCallCount += 1;
        else paidCallCount += 1;
        costByTool[entry.toolName] =
          (costByTool[entry.toolName] ?? 0) + entry.estimatedCostUsdMicro;
        costByTier[entry.tier] += entry.estimatedCostUsdMicro;
      }

      return {
        tenantId,
        totalCostUsdMicro,
        callCount: scoped.length,
        freeCallCount,
        paidCallCount,
        costByTool,
        costByTier,
        periodStart,
        periodEnd,
      };
    },
  };
}

// ============================================================================
// Batching writer
// ============================================================================

export interface CostBatcherConfig {
  readonly batchSize?: number;
  readonly flushIntervalMs?: number;
}

export interface CostBatcher {
  enqueue(entry: McpCostEntry): void;
  flush(): Promise<number>;
  stop(): void;
  snapshot(tenantId: string): Promise<McpCostSnapshot>;
}

export function createCostBatcher(
  ledger: CostLedgerPort,
  config: CostBatcherConfig = {},
): CostBatcher {
  const batchSize = config.batchSize ?? 10;
  const flushIntervalMs = config.flushIntervalMs ?? 30_000;

  let pending: ReadonlyArray<McpCostEntry> = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  function ensureTimer(): void {
    if (timer) return;
    timer = setInterval(() => {
      void flush().catch(() => {
        /* non-fatal: entries stay in queue */
      });
    }, flushIntervalMs);
    // Don't hold the event loop open just for cost flushing.
    const maybeUnref = (timer as unknown as { unref?: () => void }).unref;
    if (typeof maybeUnref === 'function') maybeUnref.call(timer);
  }

  async function flush(): Promise<number> {
    if (pending.length === 0) return 0;
    const toFlush = pending;
    pending = [];
    try {
      for (const entry of toFlush) {
        await ledger.record(entry);
      }
      return toFlush.length;
    } catch (err) {
      pending = [...toFlush, ...pending];
      throw err;
    }
  }

  return {
    enqueue(entry) {
      pending = [...pending, entry];
      ensureTimer();
      if (pending.length >= batchSize) {
        void flush().catch(() => {
          /* non-fatal */
        });
      }
    },
    async flush() {
      return flush();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    async snapshot(tenantId) {
      return ledger.snapshot(tenantId);
    },
  };
}
