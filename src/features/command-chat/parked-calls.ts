/**
 * Parked tool-call store.
 *
 * When a write/destructive/sovereign tool is requested, we DO NOT
 * execute it immediately. We persist the call here, ship a
 * `confirm-needed` SSE event to the client, and wait for the user to
 * POST `/api/command-chat/confirm/[toolCallId]`. On confirmation the
 * route re-loads the parked call, executes it through
 * `assertTierPolicy` + `executeBrainTool`, then streams the result.
 *
 * The store is intentionally pluggable. In-memory map for dev / test.
 * Production swaps in Redis via `setParkedCallStore`.
 */

export interface ParkedCall {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly tier: "write" | "destructive" | "sovereign";
  readonly userId: string;
  readonly correlationId: string;
  readonly traceId: string;
  readonly createdAt: number;
  readonly expiresAtMs: number;
}

export interface ParkedCallStore {
  put(call: ParkedCall): Promise<void>;
  get(toolCallId: string, userId: string): Promise<ParkedCall | null>;
  /** Mark consumed (one-shot). Returns the call if it was still alive. */
  consume(toolCallId: string, userId: string): Promise<ParkedCall | null>;
}

function buildInMemoryStore(): ParkedCallStore {
  const inner = new Map<string, ParkedCall>();
  return {
    async put(call) {
      // Immutable Map snapshot semantics aren't possible here (the API
      // is async + shared); we use a side-effecting Map but never
      // mutate a stored call after insert.
      inner.set(call.toolCallId, call);
    },
    async get(toolCallId, userId) {
      const c = inner.get(toolCallId);
      if (!c) return null;
      if (c.userId !== userId) return null;
      if (Date.now() > c.expiresAtMs) {
        inner.delete(toolCallId);
        return null;
      }
      return c;
    },
    async consume(toolCallId, userId) {
      const c = inner.get(toolCallId);
      if (!c) return null;
      if (c.userId !== userId) return null;
      inner.delete(toolCallId);
      if (Date.now() > c.expiresAtMs) return null;
      return c;
    },
  };
}

let activeStore: ParkedCallStore = buildInMemoryStore();

export function getParkedCallStore(): ParkedCallStore {
  return activeStore;
}

export function setParkedCallStore(store: ParkedCallStore): void {
  activeStore = store;
}

/** Test-only: reset to a fresh in-memory store. */
export function __resetParkedCallStoreForTests(): void {
  activeStore = buildInMemoryStore();
}
