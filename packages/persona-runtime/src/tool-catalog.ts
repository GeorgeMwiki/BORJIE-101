/**
 * Tool-catalog computation.
 *
 * Given a persona + authorization context, returns the frozen list of
 * tool ids the caller may invoke RIGHT NOW. Combines five filters in
 * order — each step can only REMOVE tools, never add:
 *
 *   1. Start from `persona.toolCatalogIds`.
 *   2. Apply the kill-switch — when open, ALL tools removed (empty
 *      list returned; caller still gets an immutable array, never null).
 *   3. Apply the channel allowlist — tools registered for channels not
 *      in the persona's `channelAllowlist` are dropped.
 *   4. Apply feature flags — when `tool:write:<tool>` is FALSE in
 *      `featureFlags`, the tool is dropped.
 *   5. Apply the `maxActionTier` ceiling — tools whose declared stakes
 *      exceed the ceiling are dropped.
 *
 * The function is pure. The output is `Object.freeze`d so downstream
 * code can't mutate it.
 */

import {
  isActionTierAllowed,
  type ActionTier,
  type AuthorizationContext,
  type Channel,
  type Persona,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Tool descriptor — minimal shape known to this package. Concrete
// adapters can register richer ActionToolDef rows in their registries;
// what we need here is enough metadata to filter.
// ─────────────────────────────────────────────────────────────────────

export interface ToolDescriptor {
  readonly id: string;
  /** Channels this tool can be invoked from. EMPTY = web only. */
  readonly channels?: ReadonlyArray<Channel>;
  /** Required action stakes — drives the max_action_tier ceiling check. */
  readonly stakes?: ActionTier;
}

/**
 * Optional repository of known tool descriptors. When omitted, the
 * computation treats `persona.toolCatalogIds` as ground truth and only
 * applies the kill-switch and feature-flag filters.
 */
export type ToolDescriptorMap = Readonly<Record<string, ToolDescriptor>>;

export interface ComputeToolCatalogArgs {
  readonly persona: Persona;
  readonly ctx: AuthorizationContext;
  readonly descriptors?: ToolDescriptorMap;
}

export interface ComputeToolCatalogResult {
  readonly toolIds: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<{
    readonly toolId: string;
    readonly reason: string;
  }>;
}

export const FEATURE_FLAG_PREFIX = 'tool:write:';

/**
 * Compute the active tool catalogue for (persona, ctx). Always returns
 * an immutable shape — caller can `freeze` again if it wants belt-and-
 * braces.
 */
export function computeToolCatalog(
  args: ComputeToolCatalogArgs,
): ComputeToolCatalogResult {
  const { persona, ctx, descriptors } = args;

  // (2) Kill-switch fail-closed.
  if (ctx.killSwitchOpen) {
    return Object.freeze({
      toolIds: Object.freeze([] as ReadonlyArray<string>),
      removed: Object.freeze(
        persona.toolCatalogIds.map((id) => ({
          toolId: id,
          reason: 'kill-switch open — every tool removed',
        })),
      ),
    });
  }

  const removed: Array<{ readonly toolId: string; readonly reason: string }> =
    [];
  const allowed: string[] = [];

  for (const toolId of persona.toolCatalogIds) {
    const desc = descriptors?.[toolId];

    // (3) Channel allowlist.
    if (desc?.channels && desc.channels.length > 0) {
      if (!desc.channels.includes(ctx.channel)) {
        removed.push({
          toolId,
          reason: `channel ${ctx.channel} not in tool channels [${desc.channels.join(',')}]`,
        });
        continue;
      }
    }

    // Persona-level channel allowlist — defence in depth.
    if (!persona.channelAllowlist.includes(ctx.channel)) {
      removed.push({
        toolId,
        reason: `channel ${ctx.channel} not in persona allowlist [${persona.channelAllowlist.join(',')}]`,
      });
      continue;
    }

    // (4) Feature flag.
    const flagKey = `${FEATURE_FLAG_PREFIX}${toolId}`;
    const flag = ctx.featureFlags[flagKey];
    if (flag === false) {
      removed.push({
        toolId,
        reason: `feature flag ${flagKey} = false`,
      });
      continue;
    }

    // (5) Max action tier ceiling.
    if (desc?.stakes) {
      if (!isActionTierAllowed(desc.stakes, persona.maxActionTier)) {
        removed.push({
          toolId,
          reason: `tool stakes ${desc.stakes} > persona ceiling ${persona.maxActionTier}`,
        });
        continue;
      }
    }

    allowed.push(toolId);
  }

  return Object.freeze({
    toolIds: Object.freeze(allowed),
    removed: Object.freeze(removed),
  });
}
