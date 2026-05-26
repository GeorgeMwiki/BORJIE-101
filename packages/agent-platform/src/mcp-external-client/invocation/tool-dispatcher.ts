/**
 * Kernel-side dispatcher for external MCP tool calls.
 *
 * This is the **only** entry point the kernel uses to invoke a remote
 * MCP tool. It enforces three invariants on every call (spec §6):
 *
 *   1. Mutation-authority tier check — block tier-2 ops unless the
 *      catalog entry permits them.
 *   2. Audit-chain link — emit a row to `mcp_tool_invocations` and a
 *      hash link to `ai_audit_chain`.
 *   3. Result mapping — normalise the SDK shape via `mapMcpResult`.
 *
 * Spec: `Docs/DESIGN/MCP_EXTERNAL_CLIENT_SPEC.md` §6.
 */

import type {
  McpAuditLink,
  McpCatalogEntry,
  McpMutationTier,
  McpToolInvocation,
  McpToolResult,
} from '../types.js';

/**
 * Per-tool tier override map. The dispatcher consults this *before* the
 * catalog default. Today this is small and hand-curated; future waves
 * will load it from `mcp_tool_invocations` policy rules.
 */
export type TierOverrideMap = ReadonlyMap<string, McpMutationTier>;

export interface MutationAuthority {
  readonly assertAllowed: (input: {
    readonly tenantId: string;
    readonly tier: McpMutationTier;
    readonly serverId: string;
    readonly toolName: string;
  }) => Promise<void>;
}

export interface AuditChainSink {
  readonly append: (link: McpAuditLink) => Promise<void>;
}

export interface ConnectionLookup {
  readonly findByServer: (
    tenantId: string,
    serverId: string,
  ) => Promise<{
    readonly connectionId: string;
    readonly entry: McpCatalogEntry;
  } | null>;
}

export interface InvokeAdapter {
  readonly invoke: (
    invocation: McpToolInvocation,
  ) => Promise<McpToolResult>;
}

export interface ToolDispatcherDeps {
  readonly mutationAuthority: MutationAuthority;
  readonly auditSink: AuditChainSink;
  readonly connectionLookup: ConnectionLookup;
  readonly invoker: InvokeAdapter;
  readonly tierOverrides?: TierOverrideMap;
  readonly hash?: (value: string) => string;
  readonly now?: () => number;
}

/**
 * `dispatchExternalTool(invocation)` — the one-call API. The caller
 * (kernel tool registry adapter) hands us a canonical
 * `McpToolInvocation`; we return a canonical `McpToolResult`.
 */
export function createToolDispatcher(deps: ToolDispatcherDeps): {
  readonly dispatch: (
    invocation: McpToolInvocation,
  ) => Promise<McpToolResult>;
} {
  const now = deps.now ?? Date.now;
  const hash = deps.hash ?? defaultHash;
  const tierOverrides =
    deps.tierOverrides ?? new Map<string, McpMutationTier>();

  async function dispatch(
    invocation: McpToolInvocation,
  ): Promise<McpToolResult> {
    const conn = await deps.connectionLookup.findByServer(
      invocation.tenantId,
      invocation.serverId,
    );
    if (!conn) {
      throw new Error(
        `tool-dispatcher: no connection for tenant=${invocation.tenantId} server=${invocation.serverId}`,
      );
    }
    const tierKey = `${conn.entry.id}:${invocation.toolName}`;
    const tier = tierOverrides.get(tierKey) ?? conn.entry.maxTier;
    await deps.mutationAuthority.assertAllowed({
      tenantId: invocation.tenantId,
      tier,
      serverId: invocation.serverId,
      toolName: invocation.toolName,
    });

    const startedAt = now();
    const inputHash = hash(JSON.stringify(invocation.input ?? {}));
    let result: McpToolResult;
    let outcome: 'ok' | 'error' = 'ok';
    let errorMessage: string | undefined;
    try {
      result = await deps.invoker.invoke(invocation);
      if (!result.ok) {
        outcome = 'error';
        errorMessage = result.errorMessage;
      }
    } catch (err) {
      outcome = 'error';
      errorMessage = err instanceof Error ? err.message : 'unknown error';
      result = Object.freeze({
        ok: false,
        content: Object.freeze([]),
        errorMessage,
      });
    }

    const finishedAt = now();
    const outputHash = hash(JSON.stringify(result.content ?? []));
    const link: McpAuditLink = errorMessage
      ? Object.freeze({
          tenantId: invocation.tenantId,
          connectionId: conn.connectionId,
          toolName: invocation.toolName,
          inputHash,
          outputHash,
          startedAt,
          finishedAt,
          outcome,
          errorMessage,
        })
      : Object.freeze({
          tenantId: invocation.tenantId,
          connectionId: conn.connectionId,
          toolName: invocation.toolName,
          inputHash,
          outputHash,
          startedAt,
          finishedAt,
          outcome,
        });

    try {
      await deps.auditSink.append(link);
    } catch {
      // Audit failures must not block the response; the sink is
      // expected to retry on its own. We surface the original result.
    }
    return result;
  }

  return Object.freeze({ dispatch });
}

/**
 * Deterministic non-cryptographic fallback hash. Production wires in
 * SHA-256 from `node:crypto`; this default exists so the dispatcher is
 * usable in tests without seeding crypto.
 */
function defaultHash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
