/**
 * PreToolUse: sandbox-divert hook — when the caller is in shadow / dry-run
 * mode, route the tool call to a sandbox (no real side-effects) instead
 * of denying.
 *
 * The shadow-mode resolver port reads the active rollout / kill-switch
 * state. When it returns a sandbox id the hook emits `sandbox` and the
 * orchestrator's dispatcher routes the call through the speculative
 * runner.
 */

import type { Decision } from '../../decision.js';
import type { HookContext, HookResult, PreToolUseHook } from '../../hook-chain.js';

// ─────────────────────────────────────────────────────────────────────
// Port
// ─────────────────────────────────────────────────────────────────────

export interface SandboxResolverPort {
  /**
   * Returns a sandbox id when the call should be diverted; null when it
   * should pass through to production tooling.
   */
  resolve(args: {
    readonly tenantId: string;
    readonly toolName: string;
  }): Promise<string | null>;
}

export interface SandboxDivertHookDeps {
  readonly resolver: SandboxResolverPort;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createSandboxDivertHook(
  deps: SandboxDivertHookDeps,
): PreToolUseHook {
  return {
    name: 'sandbox-divert',
    stage: 'pre-tool-use',
    async fn(ctx: HookContext, decision: Decision): Promise<HookResult> {
      if (decision.kind !== 'tool_call') return { kind: 'allow' };
      const tenantId =
        ctx.scope.kind === 'platform' ? '_platform' : ctx.scope.tenantId;
      const sandboxId = await deps.resolver.resolve({
        tenantId,
        toolName: decision.call.toolName,
      });
      if (!sandboxId) return { kind: 'allow' };
      return { kind: 'sandbox', sandboxId };
    },
  };
}
