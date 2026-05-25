/**
 * MCP safety barrel.
 *
 * - MCP_SAFE allowlist (deny-by-default registry).
 * - Tier-policy guard for queued / scheduled tool invocations
 *   (privilege-laundering defense).
 */

export {
  MCP_SAFE_POLICY,
  MCP_SAFE_POLICY_VERSION,
  isToolMcpSafe,
  getMcpToolPolicy,
  filterMcpSafe,
  filterMcpSafeForTier,
  type McpToolPolicy,
} from './mcp-safe-allowlist.js';

export {
  guardScheduledInvocation,
  captureInvocationContext,
  type QueuedInvocationContext,
  type CurrentCallerSnapshot,
  type GuardDecision,
  type GuardDenyReason,
} from './tier-policy-guard.js';
