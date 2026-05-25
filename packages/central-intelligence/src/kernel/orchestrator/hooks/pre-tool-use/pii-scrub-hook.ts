/**
 * PreToolUse: PII-scrub hook — strips PII out of the decision's tool
 * input BEFORE the tool sees it. When PII is found the hook returns
 * `transform` with a replacement decision carrying the scrubbed payload.
 *
 * The hook does NOT block by itself; that's the job of the policy /
 * inviolable gates. It only sanitises the payload so a downstream
 * tool (or third-party connector) never sees the raw PII bytes.
 *
 * The scrubber port is injectable so this orchestrator package stays
 * dep-free of `@borjie/ai-copilot`. Composition root binds the real
 * `scrubPii` from ai-copilot/src/security/pii-scrubber.
 */

import type { Decision } from '../../decision.js';
import type { HookContext, HookResult, PreToolUseHook } from '../../hook-chain.js';

// ─────────────────────────────────────────────────────────────────────
// Port
// ─────────────────────────────────────────────────────────────────────

export interface PiiScrubberPort {
  scrub(text: string): { readonly scrubbed: string; readonly hasPii: boolean };
}

export interface PiiScrubHookDeps {
  readonly scrubber: PiiScrubberPort;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createPiiScrubHook(deps: PiiScrubHookDeps): PreToolUseHook {
  return {
    name: 'pii-scrub',
    stage: 'pre-tool-use',
    async fn(_ctx: HookContext, decision: Decision): Promise<HookResult> {
      if (decision.kind !== 'tool_call') return { kind: 'allow' };
      const payload = decision.call.input;
      const scrubbed: Record<string, unknown> = {};
      let anyPii = false;
      for (const [k, v] of Object.entries(payload)) {
        if (typeof v === 'string') {
          const r = deps.scrubber.scrub(v);
          if (r.hasPii) anyPii = true;
          scrubbed[k] = r.scrubbed;
        } else {
          scrubbed[k] = v;
        }
      }
      if (!anyPii) return { kind: 'allow' };
      return {
        kind: 'transform',
        replacement: {
          kind: 'tool_call',
          call: { ...decision.call, input: scrubbed },
        },
      };
    },
  };
}
