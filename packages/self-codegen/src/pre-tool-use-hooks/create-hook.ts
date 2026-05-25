/**
 * createSelfCodegenHook — returns a PreToolUseHook that denies destructive
 * globs and optionally asks for approval on sensitive ones.
 *
 * The hook is intentionally async-friendly so K-A's hook-chain can compose
 * it with the audit hook (`post-tool-audit-hook`) without serialization.
 */

import { anyGlobMatches } from './glob-matcher.js';
import {
  DEFAULT_DENY_GLOBS,
  DEFAULT_INSPECTED_TOOLS,
  type PreToolUseDecision,
  type PreToolUseHook,
  type PreToolUseInput,
  type SelfCodegenHookConfig,
} from './types.js';

export function createSelfCodegenHook(
  config: SelfCodegenHookConfig = {},
): PreToolUseHook {
  const denyGlobs = config.denyGlobs ?? DEFAULT_DENY_GLOBS;
  const requireApproval = config.requireApproval ?? [];
  const inspectedTools = new Set(config.inspectedTools ?? DEFAULT_INSPECTED_TOOLS);

  return async (input: PreToolUseInput): Promise<PreToolUseDecision> => {
    if (!inspectedTools.has(input.toolName)) {
      return { kind: 'allow' };
    }
    const path = input.toolInput.file_path;
    if (!path) {
      // No file_path on a write-class tool is suspicious. Ask, don't ban.
      return {
        kind: 'ask',
        reason: `Write-class tool "${input.toolName}" called without file_path. Requesting human review.`,
      };
    }
    const denyHit = anyGlobMatches(denyGlobs, path);
    if (denyHit.matched) {
      return {
        kind: 'deny',
        code: 'destructive-glob',
        reason: `Path "${path}" matches deny-glob "${denyHit.glob}". Open a PR with CODEOWNER review instead.`,
      };
    }
    const askHit = anyGlobMatches(requireApproval, path);
    if (askHit.matched) {
      return {
        kind: 'ask',
        reason: `Path "${path}" matches approval-glob "${askHit.glob}". Requesting human review.`,
      };
    }
    return { kind: 'allow' };
  };
}

/**
 * Adapt the typed hook to the Claude Agent SDK's HookCallback signature so
 * K-A's hook-chain can consume it without a shim.
 */
export function asClaudeAgentSdkHook(
  hook: PreToolUseHook,
): (raw: Record<string, unknown>) => Promise<Record<string, unknown>> {
  return async (raw): Promise<Record<string, unknown>> => {
    if (raw.hook_event_name !== 'PreToolUse') return {};
    const input: PreToolUseInput = {
      toolName: String(raw.tool_name ?? ''),
      toolInput: (raw.tool_input as PreToolUseInput['toolInput']) ?? {},
      sessionId: raw.session_id ? String(raw.session_id) : undefined,
      tenantId: raw.tenant_id ? String(raw.tenant_id) : undefined,
    };
    const decision = await hook(input);
    if (decision.kind === 'allow') return {};
    if (decision.kind === 'deny') {
      return {
        systemMessage: `Blocked: ${decision.reason}`,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: decision.reason,
          code: decision.code,
        },
      };
    }
    return {
      systemMessage: `Ask: ${decision.reason}`,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: decision.reason,
      },
    };
  };
}
