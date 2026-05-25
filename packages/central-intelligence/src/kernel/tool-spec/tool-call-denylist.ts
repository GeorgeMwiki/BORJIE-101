/**
 * Per-tenant tool-call denylist.
 *
 * Phase D agent D9 — A3/A5 Tier-2 closure (Agentforce Trust Layer).
 *
 * Operators sometimes need to disable a specific BrainToolSpec for a
 * single tenant — for example, a regulator may have ordered the
 * `computeKraMri` tool off-line for an organisation under investigation.
 * The denylist is consulted by the executor BEFORE the tool runs; a
 * denied call is rejected with a typed error and an audit row.
 *
 * Storage is pluggable via the `ToolCallDenylistStore` port. The in-
 * memory implementation is the default for tests + local dev.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCallDenialEntry {
  readonly tenantId: string;
  readonly toolName: string;
  /** Optional ISO timestamp at which the deny rule lapses. */
  readonly expiresAt?: string;
  /** Free-text rationale recorded for the audit trail. */
  readonly reason: string;
  /** Operator who applied the rule. */
  readonly appliedBy?: string;
}

export interface ToolCallDenylistStore {
  list(tenantId: string): Promise<ReadonlyArray<ToolCallDenialEntry>>;
  add(entry: ToolCallDenialEntry): Promise<void>;
  remove(tenantId: string, toolName: string): Promise<void>;
}

export class ToolCallDeniedError extends Error {
  readonly code = 'TOOL_CALL_DENIED' as const;
  readonly tenantId: string;
  readonly toolName: string;
  readonly reason: string;
  constructor(tenantId: string, toolName: string, reason: string) {
    super(`Tool "${toolName}" denied for tenant "${tenantId}": ${reason}`);
    this.name = 'ToolCallDeniedError';
    this.tenantId = tenantId;
    this.toolName = toolName;
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export function createInMemoryToolCallDenylist(): ToolCallDenylistStore {
  // tenantId → (toolName → entry)
  const data = new Map<string, Map<string, ToolCallDenialEntry>>();

  return {
    async list(tenantId) {
      const m = data.get(tenantId);
      if (!m) return [];
      return Object.freeze([...m.values()]);
    },
    async add(entry) {
      let m = data.get(entry.tenantId);
      if (!m) {
        m = new Map();
        data.set(entry.tenantId, m);
      }
      m.set(entry.toolName, entry);
    },
    async remove(tenantId, toolName) {
      data.get(tenantId)?.delete(toolName);
    },
  };
}

// ---------------------------------------------------------------------------
// Check primitive (used by the executor)
// ---------------------------------------------------------------------------

export interface DenylistCheckOptions {
  readonly now?: () => Date;
}

/**
 * Returns the matched deny entry when the (tenant, tool) pair is
 * currently denied. Honors `expiresAt` and ignores expired rules.
 */
export async function checkToolCallDenylist(
  store: ToolCallDenylistStore,
  tenantId: string,
  toolName: string,
  opts: DenylistCheckOptions = {},
): Promise<ToolCallDenialEntry | null> {
  const now = (opts.now ?? (() => new Date()))();
  const entries = await store.list(tenantId);
  for (const e of entries) {
    if (e.toolName !== toolName) continue;
    if (e.expiresAt && new Date(e.expiresAt).getTime() <= now.getTime()) {
      continue;
    }
    return e;
  }
  return null;
}

/**
 * Throw if the pair is denied. Convenience wrapper for the executor.
 */
export async function assertToolCallAllowed(
  store: ToolCallDenylistStore,
  tenantId: string,
  toolName: string,
  opts?: DenylistCheckOptions,
): Promise<void> {
  const denial = await checkToolCallDenylist(store, tenantId, toolName, opts);
  if (denial) {
    throw new ToolCallDeniedError(tenantId, toolName, denial.reason);
  }
}
