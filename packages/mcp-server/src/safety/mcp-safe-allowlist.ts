/**
 * MCP_SAFE allowlist — deny-by-default registry of tools allowed to be
 * exposed over the MCP surface (Claude Desktop / GPT / Cursor / partner
 * platforms).
 *
 * Threat: a recently-built tool that is safe to call from inside a
 * BORJIE portal may be unsafe to expose to external agents
 * because:
 *   - it reads cross-tenant aggregates (e.g. "read_brain_pulse"),
 *   - it triggers simulations that mutate the world model
 *     (e.g. "simulate_decision"),
 *   - it accepts callbacks that an external agent could weaponize.
 *
 * Pattern ported from LITFIN `src/core/brain/operator-agent-tools.ts:50-55`
 * — every excluded tool carries an audit citation explaining WHY it is
 * excluded. The audit citation IS the contract: re-adding an excluded
 * tool requires updating the citation and bumping `policyVersion`.
 *
 * Pure functions. The MCP server's `listTools` / `dispatch` paths must
 * call `isToolMcpSafe(toolName)` before publishing or invoking a tool.
 */

export interface McpToolPolicy {
  /** Whether this tool may be exposed over the MCP surface. */
  readonly mcpSafe: boolean;
  /** Citation explaining the policy decision (audit ID + reasoning). */
  readonly citation: string;
  /** Human-readable reason (shown in MCP server admin UI). */
  readonly reason: string;
  /** Minimum tenant tier that may invoke this tool over MCP. */
  readonly minTier?: 'free' | 'growth' | 'enterprise';
}

/**
 * The authoritative MCP allowlist. The map is keyed by tool name (NOT
 * registry index) so renames + namespace changes do not silently flip
 * a tool from deny to allow.
 *
 * If a tool is NOT in this map, it is implicitly DENIED for MCP (deny
 * by default). Add new entries only after security review.
 *
 * Convention: tool names are colon-separated namespace:verb tokens,
 * matching the rest of the BORJIE tool registry.
 */
export const MCP_SAFE_POLICY: Readonly<Record<string, McpToolPolicy>> =
  Object.freeze({
    // ── Read-only, single-tenant, low-blast-radius ─────────────────
    'property:list_for_tenant': {
      mcpSafe: true,
      citation: 'mcp-safe/2026-05-23/A1 — read-only, tenant-scoped, no PII outside the asking tenant',
      reason: 'List properties belonging to the asking tenant.',
    },
    'property:get_by_id': {
      mcpSafe: true,
      citation: 'mcp-safe/2026-05-23/A1',
      reason: 'Fetch property detail; RLS enforces tenant boundary.',
    },
    'lease:list_for_tenant': {
      mcpSafe: true,
      citation: 'mcp-safe/2026-05-23/A1',
      reason: 'List leases belonging to the asking tenant.',
    },
    'lease:get_by_id': {
      mcpSafe: true,
      citation: 'mcp-safe/2026-05-23/A1',
      reason: 'Fetch lease detail; RLS enforces tenant boundary.',
    },
    'maintenance:list_open': {
      mcpSafe: true,
      citation: 'mcp-safe/2026-05-23/A1',
      reason: 'List open maintenance tickets for the asking tenant.',
    },
    'payment:list_for_lease': {
      mcpSafe: true,
      citation: 'mcp-safe/2026-05-23/A2 — read-only, tenant-scoped, financial PII gated by tier',
      reason: 'List rent payments for a lease the caller owns.',
      minTier: 'growth',
    },

    // ── Write paths exposed only to enterprise (with confidence-band) ─
    'maintenance:create_ticket': {
      mcpSafe: true,
      citation: 'mcp-safe/2026-05-23/B1 — write path, reversible, idempotent on natural key',
      reason: 'Create a maintenance ticket; deduped on title+property+24h.',
      minTier: 'growth',
    },
    'communication:draft_for_tenant': {
      mcpSafe: true,
      citation: 'mcp-safe/2026-05-23/B2 — drafts only, never sends without human approve',
      reason: 'Draft a tenant communication; requires human send action.',
      minTier: 'growth',
    },

    // ── EXPLICITLY DENIED (each with a real audit citation) ─────────
    simulate_decision: {
      mcpSafe: false,
      citation: 'mcp-safe/2026-05-23/H1 — H1 audit found simulation mutates world-model under tenant context; not safe to expose to external callers',
      reason: 'simulate_decision can mutate the world model and is denied over MCP.',
    },
    read_brain_pulse: {
      mcpSafe: false,
      citation: 'mcp-safe/2026-05-23/C2 — C2 audit 2026-05-18 found cross-tenant aggregate leak in read_brain_pulse; quarantined from MCP until refactor',
      reason: 'read_brain_pulse exposes cross-tenant aggregates; denied.',
    },
    'platform:set_killswitch': {
      mcpSafe: false,
      citation: 'mcp-safe/2026-05-23/D1 — killswitch is a platform-operator-only control; external agents must never trip it',
      reason: 'Killswitch is an operator-only control surface.',
    },
    'admin:impersonate_user': {
      mcpSafe: false,
      citation: 'mcp-safe/2026-05-23/D2 — impersonation is denied for ALL external surfaces; internal admin only',
      reason: 'Impersonation is restricted to internal admin tooling.',
    },
    'sovereign:adjust_pricing': {
      mcpSafe: false,
      citation: 'mcp-safe/2026-05-23/D3 — sovereign:* is the cross-tenant control plane; never exposed to MCP',
      reason: 'sovereign:* tools are control-plane and denied over MCP.',
    },
    'sovereign:reroute_ai_traffic': {
      mcpSafe: false,
      citation: 'mcp-safe/2026-05-23/D3',
      reason: 'sovereign:* tools are control-plane and denied over MCP.',
    },
  });

/**
 * Current MCP-safe policy version. Bump when adding or removing
 * entries from MCP_SAFE_POLICY so downstream audit consumers can
 * detect drift.
 */
export const MCP_SAFE_POLICY_VERSION = '1.0.0';

/**
 * Returns true iff the named tool may be exposed over MCP. Tools not
 * in the policy are denied by default.
 */
export function isToolMcpSafe(toolName: string): boolean {
  return MCP_SAFE_POLICY[toolName]?.mcpSafe === true;
}

/**
 * Returns the policy record for a tool or `null` when not registered.
 * Callers that want the citation for an admin audit should use this.
 */
export function getMcpToolPolicy(toolName: string): McpToolPolicy | null {
  return MCP_SAFE_POLICY[toolName] ?? null;
}

/**
 * Returns the subset of an input tool list that is MCP-safe. The
 * MCP server's `listTools` handler should pipe its full tool list
 * through this filter before publishing.
 */
export function filterMcpSafe<T extends { name: string }>(
  tools: ReadonlyArray<T>,
): ReadonlyArray<T> {
  return tools.filter((t) => isToolMcpSafe(t.name));
}

/**
 * Per-tier filter — additionally drops tools whose `minTier` exceeds
 * the caller's tier.
 */
export function filterMcpSafeForTier<T extends { name: string }>(
  tools: ReadonlyArray<T>,
  callerTier: 'free' | 'growth' | 'enterprise',
): ReadonlyArray<T> {
  const tierOrder = { free: 0, growth: 1, enterprise: 2 } as const;
  const callerLevel = tierOrder[callerTier];
  return tools.filter((t) => {
    const policy = MCP_SAFE_POLICY[t.name];
    if (!policy || !policy.mcpSafe) return false;
    if (!policy.minTier) return true;
    return tierOrder[policy.minTier] <= callerLevel;
  });
}
