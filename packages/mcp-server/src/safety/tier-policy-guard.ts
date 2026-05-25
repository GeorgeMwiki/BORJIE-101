/**
 * Tier-policy guard for queued / scheduled / cron-dispatched tools.
 *
 * Threat: privilege laundering. A property manager schedules a tool
 * call for tomorrow 02:00. Between now and then their tier is
 * downgraded (e.g. enterprise→growth on contract expiry) OR they
 * are removed from the property. At dispatch time the tool would
 * otherwise still execute with the ORIGINAL caller's permissions
 * because the cron rehydrates the persisted job.
 *
 * Pattern ported from LITFIN `src/core/litfin-ai/actions/tools/schedule-action.ts:64-73`
 * (iter-44 CRITICAL #1 audit fix). At ENQUEUE time we persist the
 * caller's portal + role. At DEQUEUE time we re-evaluate the
 * caller's CURRENT tier and re-check the tool policy before
 * invoking. If the caller no longer has the required tier, the job
 * is dead-lettered with `reason: 'tier-downgraded-since-enqueue'`.
 *
 * Pure functions. The queue runtime calls `guardScheduledInvocation`
 * before invoking the tool body.
 */

import { MCP_SAFE_POLICY, type McpToolPolicy } from './mcp-safe-allowlist.js';

/**
 * Snapshot persisted alongside the queued job at enqueue time. The
 * snapshot is opaque to the queue infrastructure; the guard reads it
 * back to re-evaluate at dequeue.
 */
export interface QueuedInvocationContext {
  readonly toolName: string;
  readonly enqueuedAt: string; // ISO 8601
  readonly originalCallerId: string;
  readonly originalPortalId: string;
  readonly originalUserRole: string;
  readonly originalTier: 'free' | 'growth' | 'enterprise';
  readonly tenantId: string;
}

/** What the queue runtime knows about the caller at dequeue time. */
export interface CurrentCallerSnapshot {
  readonly callerId: string;
  readonly currentTier: 'free' | 'growth' | 'enterprise';
  readonly currentPortalId: string;
  readonly currentUserRole: string;
  /** True iff the caller still has SOME access to the tenant. */
  readonly stillAttachedToTenant: boolean;
}

export type GuardDecision =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: GuardDenyReason; readonly detail: string };

export type GuardDenyReason =
  | 'tool-no-longer-in-policy'
  | 'tool-removed-from-mcp-safe'
  | 'tier-downgraded-since-enqueue'
  | 'caller-detached-from-tenant'
  | 'caller-id-mismatch';

const TIER_ORDER = { free: 0, growth: 1, enterprise: 2 } as const;

/**
 * Re-evaluate whether the queued invocation is still allowed to run.
 *
 *   - Denies if the tool was removed from MCP_SAFE_POLICY since enqueue.
 *   - Denies if the tool's minTier rose above the caller's CURRENT tier.
 *   - Denies if the caller no longer has any attachment to the tenant.
 *   - Denies if the caller id changed (shouldn't happen, but defends
 *     against a rehydration bug where the queue swapped the actor).
 */
export function guardScheduledInvocation(
  queued: QueuedInvocationContext,
  current: CurrentCallerSnapshot,
): GuardDecision {
  // 1. Caller identity must match what was enqueued.
  if (queued.originalCallerId !== current.callerId) {
    return {
      allow: false,
      reason: 'caller-id-mismatch',
      detail: `enqueued caller ${queued.originalCallerId} != current caller ${current.callerId}`,
    };
  }

  // 2. Caller must still be attached to the tenant.
  if (!current.stillAttachedToTenant) {
    return {
      allow: false,
      reason: 'caller-detached-from-tenant',
      detail: `caller ${current.callerId} no longer has access to tenant ${queued.tenantId}`,
    };
  }

  // 3. Tool must still be in the MCP-safe policy.
  const policy: McpToolPolicy | undefined = MCP_SAFE_POLICY[queued.toolName];
  if (!policy) {
    return {
      allow: false,
      reason: 'tool-no-longer-in-policy',
      detail: `tool ${queued.toolName} is not in MCP_SAFE_POLICY at dequeue time`,
    };
  }
  if (!policy.mcpSafe) {
    return {
      allow: false,
      reason: 'tool-removed-from-mcp-safe',
      detail: `tool ${queued.toolName} was flipped to mcpSafe=false (citation: ${policy.citation})`,
    };
  }

  // 4. Caller's CURRENT tier must meet the tool's minTier (if any).
  if (policy.minTier) {
    if (TIER_ORDER[current.currentTier] < TIER_ORDER[policy.minTier]) {
      return {
        allow: false,
        reason: 'tier-downgraded-since-enqueue',
        detail: `tool ${queued.toolName} requires ${policy.minTier}; caller is now ${current.currentTier} (was ${queued.originalTier})`,
      };
    }
  }

  return { allow: true };
}

/**
 * Helper to build a `QueuedInvocationContext` at enqueue time. Use
 * this from the schedule-action / queue-publish path so the snapshot
 * shape is enforced.
 */
export function captureInvocationContext(args: {
  readonly toolName: string;
  readonly callerId: string;
  readonly portalId: string;
  readonly userRole: string;
  readonly tier: 'free' | 'growth' | 'enterprise';
  readonly tenantId: string;
  readonly enqueuedAt?: Date;
}): QueuedInvocationContext {
  return {
    toolName: args.toolName,
    enqueuedAt: (args.enqueuedAt ?? new Date()).toISOString(),
    originalCallerId: args.callerId,
    originalPortalId: args.portalId,
    originalUserRole: args.userRole,
    originalTier: args.tier,
    tenantId: args.tenantId,
  };
}
