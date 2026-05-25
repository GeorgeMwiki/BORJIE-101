/**
 * PreToolUse: tool-denylist hook — refuses any tool name on the
 * killswitched / banned list. Used to disable a tool globally without
 * unregistering it.
 *
 * Two layers:
 *
 *   - `globalDenylist`  hard-coded names that NEVER fire (e.g. a
 *                       destructive primitive that exists only for an
 *                       emergency runbook)
 *   - `dynamicDenylist` an async port the killswitch / feature-flag
 *                       service binds at composition time
 */

import type { Decision } from '../../decision.js';
import type { HookContext, HookResult, PreToolUseHook } from '../../hook-chain.js';

// ─────────────────────────────────────────────────────────────────────
// Port
// ─────────────────────────────────────────────────────────────────────

export interface ToolDenylistPort {
  isDenied(toolName: string): Promise<boolean>;
}

export interface ToolDenylistHookDeps {
  readonly globalDenylist?: ReadonlyArray<string>;
  readonly dynamic?: ToolDenylistPort;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createToolDenylistHook(
  deps: ToolDenylistHookDeps,
): PreToolUseHook {
  const globalSet = new Set(deps.globalDenylist ?? []);
  return {
    name: 'tool-denylist',
    stage: 'pre-tool-use',
    async fn(_ctx: HookContext, decision: Decision): Promise<HookResult> {
      if (decision.kind !== 'tool_call') return { kind: 'allow' };
      const name = decision.call.toolName;
      if (globalSet.has(name)) {
        return {
          kind: 'deny',
          code: 'tool-globally-denied',
          reason: `tool '${name}' is globally denied`,
        };
      }
      if (deps.dynamic && (await deps.dynamic.isDenied(name))) {
        return {
          kind: 'deny',
          code: 'tool-killswitched',
          reason: `tool '${name}' is currently killswitched`,
        };
      }
      return { kind: 'allow' };
    },
  };
}
