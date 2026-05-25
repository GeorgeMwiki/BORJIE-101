/**
 * Hook chain — Claude-Code-style lifecycle substrate.
 *
 * The original substrate exposed three stages (`pre-tool-use`,
 * `post-tool-use`, `stop`) with five `HookResult` outcomes. Phase E.6
 * widens both axes to match Claude Code's full hook surface:
 *
 *   9 stages — `session-start`, `user-prompt-submit`, `pre-tool-use`,
 *   `post-tool-use`, `pre-compact`, `post-compact`, `subagent-start`,
 *   `subagent-stop`, `stop`.
 *
 *   9 outcomes — `allow`, `deny`, `ask-owner`, `sandbox`, `transform`,
 *   `updated-input`, `additional-context`, `defer`, `stop`.
 *
 * Each Hook is a pure function (with optional async I/O) that returns a
 * `HookResult` ADT. The chain runner short-circuits on the FIRST
 * non-allow / non-side-effect result so a deny / ask / sandbox / stop
 * decision halts further chain evaluation.
 *
 * `updated-input` and `additional-context` are SIDE-EFFECT outcomes:
 * they mutate the rolling Decision / pending-context list but the chain
 * continues running so multiple hooks can compose (e.g. PII-scrub plus a
 * policy-reminder injection plus a permission gate).
 *
 * Persistence (audit emission, ledger seal) happens via injected ports
 * the hook closes over, never via shared mutable state.
 */

import type { ScopeContext } from '../../types.js';
import type { Decision, DispatchResult } from './decision.js';

// ─────────────────────────────────────────────────────────────────────
// Chat message shape — minimal, provider-agnostic. Matches the shape
// the main-loop already passes to `router.call({ messages })`.
// ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  readonly role: 'user' | 'assistant' | 'tool' | 'system';
  readonly content: string;
}

// ─────────────────────────────────────────────────────────────────────
// HookResult ADT — nine outcomes a hook can return.
// ─────────────────────────────────────────────────────────────────────

export type HookResult =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deny'; readonly reason: string; readonly code: string }
  | {
      readonly kind: 'ask-owner';
      readonly prompt: string;
      readonly channel: 'inline' | 'inbox';
    }
  | { readonly kind: 'sandbox'; readonly sandboxId: string }
  | { readonly kind: 'transform'; readonly replacement: Decision }
  /**
   * `updated-input` — the hook returns a sanitised / rewritten copy of
   * the Decision that the chain should use going forward. Distinct from
   * `transform` because the chain CONTINUES evaluating subsequent
   * hooks against the replacement (so PII-scrub + permission-gate can
   * compose: scrub first, then check perms on the scrubbed payload).
   */
  | { readonly kind: 'updated-input'; readonly replacement: Decision }
  /**
   * `additional-context` — the hook injects extra messages (e.g. a
   * policy reminder, a freshly-fetched citation) that the main-loop
   * folds into the next `router.call({ messages })`. The chain
   * continues; messages accumulate.
   */
  | {
      readonly kind: 'additional-context';
      readonly messages: ReadonlyArray<ChatMessage>;
    }
  /**
   * `defer` — pause the decision, resume after `resumeAfterMs`. The
   * main-loop schedules a wake; the orchestrator surface returns an
   * `ack-defer` to the caller.
   */
  | {
      readonly kind: 'defer';
      readonly resumeAfterMs: number;
      readonly reason: string;
    }
  /**
   * `stop` — abort the whole turn immediately. Equivalent to Claude
   * Code's `continue:false`. The main-loop returns a terminal response
   * to the caller without dispatching anything else.
   */
  | { readonly kind: 'stop'; readonly reason: string };

// ─────────────────────────────────────────────────────────────────────
// HookContext — read-only request scope passed to every hook.
// ─────────────────────────────────────────────────────────────────────

export interface HookContext {
  readonly threadId: string;
  readonly scope: ScopeContext;
  readonly tier:
    | 'tenant'
    | 'lease'
    | 'unit'
    | 'block'
    | 'property'
    | 'portfolio'
    | 'org'
    | 'industry';
  readonly userMessage: string;
  /** Wall-clock at which the orchestrator entered the current tick. */
  readonly tickStartedAt: number;
  /** Caller-supplied granted scope set (defence-in-depth for permission hook). */
  readonly grantedScopes?: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Scope filter — optional gate so a hook only fires for matching ticks.
// ─────────────────────────────────────────────────────────────────────

export interface ScopeFilter {
  readonly toolNames?: ReadonlyArray<string>;
  readonly tiers?: ReadonlyArray<HookContext['tier']>;
  readonly surfaces?: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Hook stages — nine lifecycle moments the substrate fires on.
// ─────────────────────────────────────────────────────────────────────

export type HookStage =
  | 'session-start'
  | 'user-prompt-submit'
  | 'pre-tool-use'
  | 'post-tool-use'
  | 'pre-compact'
  | 'post-compact'
  | 'subagent-start'
  | 'subagent-stop'
  | 'stop';

// ─────────────────────────────────────────────────────────────────────
// Stage-specific payloads
// ─────────────────────────────────────────────────────────────────────

/** Snapshot a `session-start` hook can inspect to seed the session. */
export interface SessionStartPayload {
  readonly threadId: string;
  readonly tier: HookContext['tier'];
  readonly resumed: boolean;
}

/** Wrapped user prompt the `user-prompt-submit` hook may scrub / reject. */
export interface UserPromptPayload {
  readonly text: string;
}

/** Compaction inputs surfaced to `pre-compact`. */
export interface PreCompactPayload {
  readonly currentTokens: number;
  readonly windowTokens: number;
  readonly ratio: number;
}

/** Compaction outcome surfaced to `post-compact`. */
export interface PostCompactPayload {
  readonly originalTokens: number;
  readonly finalTokens: number;
  readonly droppedTurnCount: number;
}

/** Sub-MD descriptor surfaced to `subagent-start` / `subagent-stop`. */
export interface SubagentPayload {
  readonly subMdId: string;
  readonly persona: string;
  readonly parentThreadId: string;
  /** Populated on stop only. */
  readonly outcome?: DispatchResult;
}

// ─────────────────────────────────────────────────────────────────────
// Hook variants — one interface per stage, each with the appropriate
// payload signature. Discriminated by `stage`.
// ─────────────────────────────────────────────────────────────────────

export interface SessionStartHook {
  readonly name: string;
  readonly stage: 'session-start';
  fn(ctx: HookContext, payload: SessionStartPayload): Promise<HookResult>;
}

export interface UserPromptSubmitHook {
  readonly name: string;
  readonly stage: 'user-prompt-submit';
  fn(ctx: HookContext, payload: UserPromptPayload): Promise<HookResult>;
}

export interface PreToolUseHook {
  readonly name: string;
  readonly stage: 'pre-tool-use';
  readonly scope?: ScopeFilter;
  fn(ctx: HookContext, decision: Decision): Promise<HookResult>;
}

export interface PostToolUseHook {
  readonly name: string;
  readonly stage: 'post-tool-use';
  readonly scope?: ScopeFilter;
  fn(
    ctx: HookContext,
    decision: Decision,
    result: DispatchResult,
  ): Promise<HookResult>;
}

export interface PreCompactHook {
  readonly name: string;
  readonly stage: 'pre-compact';
  fn(ctx: HookContext, payload: PreCompactPayload): Promise<HookResult>;
}

export interface PostCompactHook {
  readonly name: string;
  readonly stage: 'post-compact';
  fn(ctx: HookContext, payload: PostCompactPayload): Promise<HookResult>;
}

export interface SubagentStartHook {
  readonly name: string;
  readonly stage: 'subagent-start';
  fn(ctx: HookContext, payload: SubagentPayload): Promise<HookResult>;
}

export interface SubagentStopHook {
  readonly name: string;
  readonly stage: 'subagent-stop';
  fn(ctx: HookContext, payload: SubagentPayload): Promise<HookResult>;
}

export interface StopHook {
  readonly name: string;
  readonly stage: 'stop';
  fn(ctx: HookContext, session: StopSession): Promise<HookResult>;
}

export type Hook =
  | SessionStartHook
  | UserPromptSubmitHook
  | PreToolUseHook
  | PostToolUseHook
  | PreCompactHook
  | PostCompactHook
  | SubagentStartHook
  | SubagentStopHook
  | StopHook;

// ─────────────────────────────────────────────────────────────────────
// Stop session — supplied to stop-stage hooks so a ledger-seal hook
// can compute terminal hashes across the whole transcript.
// ─────────────────────────────────────────────────────────────────────

export interface StopSession {
  readonly threadId: string;
  readonly turnCount: number;
  readonly finalText: string | null;
  readonly exhaustedAxis:
    | 'turns'
    | 'tokens'
    | 'tool-calls'
    | 'wall-ms'
    | null;
}

// ─────────────────────────────────────────────────────────────────────
// PreToolUseChainResult — extended result carries side-effect outcomes
// the main-loop must thread back through subsequent ticks.
// ─────────────────────────────────────────────────────────────────────

export interface PreToolUseChainResult {
  /**
   * The final terminal outcome of the chain. Always one of `allow`,
   * `deny`, `ask-owner`, `sandbox`, `transform`, `defer`, `stop`.
   * `updated-input` and `additional-context` are folded into the
   * accumulator fields below and never appear here.
   */
  readonly outcome: HookResult;
  /**
   * If any hook returned `updated-input`, this is the final replacement
   * Decision that the dispatcher should run. `null` when no hook
   * rewrote the decision.
   */
  readonly effectiveDecision: Decision | null;
  /**
   * Accumulated `additional-context` injections, in registration order.
   * The main-loop folds these into the next `router.call({ messages })`.
   */
  readonly contextInjections: ReadonlyArray<ChatMessage>;
}

// ─────────────────────────────────────────────────────────────────────
// HookChain — orchestration over a registered hook set.
// ─────────────────────────────────────────────────────────────────────

export interface HookChain {
  runSessionStart(
    payload: SessionStartPayload,
    ctx: HookContext,
  ): Promise<HookResult>;
  runUserPromptSubmit(
    payload: UserPromptPayload,
    ctx: HookContext,
  ): Promise<HookResult>;
  runPreToolUse(
    decision: Decision,
    ctx: HookContext,
  ): Promise<PreToolUseChainResult>;
  runPostToolUse(
    decision: Decision,
    result: DispatchResult,
    ctx: HookContext,
  ): Promise<HookResult>;
  runPreCompact(
    payload: PreCompactPayload,
    ctx: HookContext,
  ): Promise<HookResult>;
  runPostCompact(
    payload: PostCompactPayload,
    ctx: HookContext,
  ): Promise<HookResult>;
  runSubagentStart(
    payload: SubagentPayload,
    ctx: HookContext,
  ): Promise<HookResult>;
  runSubagentStop(
    payload: SubagentPayload,
    ctx: HookContext,
  ): Promise<HookResult>;
  runStop(session: StopSession, ctx: HookContext): Promise<HookResult>;
  /** Read-only inventory for self-awareness / telemetry. */
  list(): ReadonlyArray<{ name: string; stage: HookStage }>;
}

// ─────────────────────────────────────────────────────────────────────
// Factory — `createHookChain(hooks)` returns a HookChain. Hooks run in
// registration order; the chain stops at the first terminal result.
// ─────────────────────────────────────────────────────────────────────

export function createHookChain(hooks: ReadonlyArray<Hook>): HookChain {
  const sessionStart = hooks.filter(
    (h): h is SessionStartHook => h.stage === 'session-start',
  );
  const userPromptSubmit = hooks.filter(
    (h): h is UserPromptSubmitHook => h.stage === 'user-prompt-submit',
  );
  const pre = hooks.filter(
    (h): h is PreToolUseHook => h.stage === 'pre-tool-use',
  );
  const post = hooks.filter(
    (h): h is PostToolUseHook => h.stage === 'post-tool-use',
  );
  const preCompact = hooks.filter(
    (h): h is PreCompactHook => h.stage === 'pre-compact',
  );
  const postCompact = hooks.filter(
    (h): h is PostCompactHook => h.stage === 'post-compact',
  );
  const subagentStart = hooks.filter(
    (h): h is SubagentStartHook => h.stage === 'subagent-start',
  );
  const subagentStop = hooks.filter(
    (h): h is SubagentStopHook => h.stage === 'subagent-stop',
  );
  const stop = hooks.filter((h): h is StopHook => h.stage === 'stop');

  // CRITICAL #8 — hook throws must NOT unwind the chain. We wrap every
  // hook invocation in try/catch and translate the throw into a typed
  // `{kind:'deny', code:'hook-threw'}` outcome. The module docstring at
  // line 16-18 promises this contract; the implementation now honours it.
  async function safeInvoke<P>(
    hook: {
      readonly name?: string;
      fn: (c: HookContext, p: P) => Promise<HookResult>;
    },
    ctx: HookContext,
    payload: P,
  ): Promise<HookResult> {
    try {
      return await hook.fn(ctx, payload);
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : 'hook threw a non-Error value';
      return {
        kind: 'deny',
        reason: `hook ${hook.name ?? '<anonymous>'} threw: ${reason}`,
        code: 'hook-threw',
      };
    }
  }

  // Generic chain runner for stages whose hooks take a single payload.
  async function runSimple<P>(
    chain: ReadonlyArray<{
      readonly name?: string;
      fn: (c: HookContext, p: P) => Promise<HookResult>;
    }>,
    ctx: HookContext,
    payload: P,
  ): Promise<HookResult> {
    for (const h of chain) {
      const out = await safeInvoke(h, ctx, payload);
      if (out.kind !== 'allow') return out;
    }
    return { kind: 'allow' };
  }

  async function runSessionStart(
    payload: SessionStartPayload,
    ctx: HookContext,
  ): Promise<HookResult> {
    return runSimple(sessionStart, ctx, payload);
  }

  async function runUserPromptSubmit(
    payload: UserPromptPayload,
    ctx: HookContext,
  ): Promise<HookResult> {
    return runSimple(userPromptSubmit, ctx, payload);
  }

  async function runPreToolUse(
    decision: Decision,
    ctx: HookContext,
  ): Promise<PreToolUseChainResult> {
    let currentDecision: Decision = decision;
    let effective: Decision | null = null;
    const injections: ChatMessage[] = [];

    for (const h of pre) {
      if (!matchesScope(h.scope, currentDecision, ctx)) continue;
      // safeInvoke maps any thrown error to a typed `deny` with
      // code `hook-threw` (CRITICAL #8). The decision argument is the
      // payload for pre-tool-use hooks.
      const out = await safeInvoke<Decision>(
        { name: h.name, fn: h.fn },
        ctx,
        currentDecision,
      );

      if (out.kind === 'allow') continue;

      if (out.kind === 'updated-input') {
        currentDecision = out.replacement;
        effective = out.replacement;
        continue;
      }

      if (out.kind === 'additional-context') {
        injections.push(...out.messages);
        continue;
      }

      // Terminal outcome — return immediately with whatever side-effects
      // have already accumulated.
      return {
        outcome: out,
        effectiveDecision: effective,
        contextInjections: injections,
      };
    }

    return {
      outcome: { kind: 'allow' },
      effectiveDecision: effective,
      contextInjections: injections,
    };
  }

  async function runPostToolUse(
    decision: Decision,
    result: DispatchResult,
    ctx: HookContext,
  ): Promise<HookResult> {
    // H3 — post-tool-use hooks are observational by contract
    // (audit-emission, ledger-seal, telemetry). Every hook MUST run
    // regardless of whether an earlier hook denied: an audit pipeline
    // that records EVERY dispatch is non-negotiable. We collect failures
    // and return the FIRST non-allow outcome AFTER the full chain has
    // executed, so the caller still gets a visible signal.
    let firstNonAllow: HookResult | null = null;
    for (const h of post) {
      if (!matchesScope(h.scope, decision, ctx)) continue;
      let out: HookResult;
      try {
        out = await h.fn(ctx, decision, result);
      } catch (err) {
        const reason =
          err instanceof Error ? err.message : 'hook threw a non-Error value';
        out = {
          kind: 'deny',
          reason: `hook ${h.name ?? '<anonymous>'} threw: ${reason}`,
          code: 'hook-threw',
        };
      }
      if (out.kind !== 'allow' && firstNonAllow === null) {
        firstNonAllow = out;
      }
    }
    return firstNonAllow ?? { kind: 'allow' };
  }

  async function runPreCompact(
    payload: PreCompactPayload,
    ctx: HookContext,
  ): Promise<HookResult> {
    return runSimple(preCompact, ctx, payload);
  }

  async function runPostCompact(
    payload: PostCompactPayload,
    ctx: HookContext,
  ): Promise<HookResult> {
    return runSimple(postCompact, ctx, payload);
  }

  async function runSubagentStart(
    payload: SubagentPayload,
    ctx: HookContext,
  ): Promise<HookResult> {
    return runSimple(subagentStart, ctx, payload);
  }

  async function runSubagentStop(
    payload: SubagentPayload,
    ctx: HookContext,
  ): Promise<HookResult> {
    return runSimple(subagentStop, ctx, payload);
  }

  async function runStop(
    session: StopSession,
    ctx: HookContext,
  ): Promise<HookResult> {
    for (const h of stop) {
      const out = await safeInvoke<StopSession>(
        { name: h.name, fn: h.fn },
        ctx,
        session,
      );
      if (out.kind !== 'allow') return out;
    }
    return { kind: 'allow' };
  }

  function list(): ReadonlyArray<{ name: string; stage: HookStage }> {
    return hooks.map((h) => ({ name: h.name, stage: h.stage }));
  }

  return {
    runSessionStart,
    runUserPromptSubmit,
    runPreToolUse,
    runPostToolUse,
    runPreCompact,
    runPostCompact,
    runSubagentStart,
    runSubagentStop,
    runStop,
    list,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function matchesScope(
  scope: ScopeFilter | undefined,
  decision: Decision,
  ctx: HookContext,
): boolean {
  if (!scope) return true;
  if (scope.toolNames && decision.kind === 'tool_call') {
    if (!scope.toolNames.includes(decision.call.toolName)) return false;
  }
  if (scope.tiers && !scope.tiers.includes(ctx.tier)) return false;
  return true;
}
