/**
 * PreToolUse: permission hook — checks the caller's granted-scope set
 * against the tool's required scopes. Denies when ANY required scope is
 * missing.
 *
 * The scope lookup port is injectable; production binds the HQ-tool
 * registry's `getRequiredScopes(toolName)`, tests inject a Map.
 */

import type { Decision } from '../../decision.js';
import type { HookContext, HookResult, PreToolUseHook } from '../../hook-chain.js';

// ─────────────────────────────────────────────────────────────────────
// Port
// ─────────────────────────────────────────────────────────────────────

export interface ToolScopePort {
  requiredScopes(toolName: string): ReadonlyArray<string>;
}

export interface PermissionHookDeps {
  readonly scopes: ToolScopePort;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createPermissionHook(deps: PermissionHookDeps): PreToolUseHook {
  return {
    name: 'permission',
    stage: 'pre-tool-use',
    async fn(ctx: HookContext, decision: Decision): Promise<HookResult> {
      if (decision.kind !== 'tool_call') return { kind: 'allow' };
      const required = deps.scopes.requiredScopes(decision.call.toolName);
      if (required.length === 0) return { kind: 'allow' };
      const granted = new Set(ctx.grantedScopes ?? []);
      const missing = required.filter((s) => !granted.has(s));
      if (missing.length === 0) return { kind: 'allow' };
      return {
        kind: 'deny',
        code: 'permission-missing-scopes',
        reason: `tool '${decision.call.toolName}' requires scopes: ${missing.join(', ')}`,
      };
    },
  };
}
