/**
 * PreToolUse: four-eye-approval hook — wraps the existing approval gate.
 *
 * The hook consults a `ToolApprovalPolicyPort` to find out whether the
 * tool the decision wants to invoke requires four-eye sign-off. When it
 * does AND no approved record exists yet for the current call, the hook
 * returns `ask-owner` so the orchestrator surfaces an approval prompt
 * instead of executing.
 *
 * The hook is intentionally a thin shim — the heavy lifting (quorum,
 * recall, plan artifact, executed flag) stays in
 * `four-eye-approval.ts`. This hook just decides "ask or allow" at the
 * orchestrator boundary.
 */

import type { Decision } from '../../decision.js';
import type { HookContext, HookResult, PreToolUseHook } from '../../hook-chain.js';

// ─────────────────────────────────────────────────────────────────────
// Port — minimal slice of the four-eye gate the hook needs.
// ─────────────────────────────────────────────────────────────────────

export interface ToolApprovalPolicyPort {
  /** True when the tool requires four-eye approval regardless of context. */
  requiresApproval(toolName: string): boolean;
  /** Approval lookup — returns the call's approval state. */
  approvalStatus(args: {
    readonly callId: string;
    readonly toolName: string;
  }): Promise<'none' | 'pending' | 'approved' | 'rejected'>;
}

export interface FourEyeHookDeps {
  readonly policy: ToolApprovalPolicyPort;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createFourEyeHook(deps: FourEyeHookDeps): PreToolUseHook {
  return {
    name: 'four-eye-approval',
    stage: 'pre-tool-use',
    async fn(_ctx: HookContext, decision: Decision): Promise<HookResult> {
      if (decision.kind !== 'tool_call') return { kind: 'allow' };
      const { toolName, callId } = decision.call;
      if (!deps.policy.requiresApproval(toolName)) return { kind: 'allow' };
      const status = await deps.policy.approvalStatus({ callId, toolName });
      switch (status) {
        case 'approved':
          return { kind: 'allow' };
        case 'rejected':
          return {
            kind: 'deny',
            code: 'four-eye-rejected',
            reason: `tool '${toolName}' was rejected by approvers`,
          };
        case 'pending':
          return {
            kind: 'ask-owner',
            channel: 'inbox',
            prompt: `Approval already pending for '${toolName}' (call ${callId})`,
          };
        case 'none':
        default:
          return {
            kind: 'ask-owner',
            channel: 'inbox',
            prompt: `Four-eye approval required for '${toolName}' (call ${callId})`,
          };
      }
    },
  };
}
