/**
 * Intent verification port — LP-04.
 *
 * Wires the EXISTING `@borjie/autonomy-governance` intent-verifier into the
 * kernel think-pipeline at the post-LLM / pre-exec seam: after the sensor
 * proposes `tool_use` calls and BEFORE `dispatchKernelTools` runs them, each
 * proposed call is checked against the user ask. A non-permitted verdict
 * blocks that tool call.
 *
 * Dependency discipline (CLAUDE.md / MODULAR_MONOLITH): central-intelligence
 * does NOT depend on autonomy-governance. This module declares a duck-typed
 * PORT only; the api-gateway composition root constructs the concrete
 * adapter from `@borjie/autonomy-governance` `verifyIntent(...)` and injects
 * it via `BrainKernelDeps.intentVerifier`. Mirrors how `reflexionWriter`,
 * `skillRetriever`, etc. are wired.
 *
 * Fail-safe contract:
 *   - No verifier wired                  → all calls allowed (no-op).
 *   - Flag disabled                      → all calls allowed.
 *   - Verifier throws on a call          → that call is ALLOWED (we never
 *                                          break the hot path on an internal
 *                                          verifier error) and the failure is
 *                                          surfaced on the result for the
 *                                          caller's trace.
 *   - Verifier returns `permitted:false` → that call is BLOCKED per policy.
 *
 * Immutability: pure data in/out, frozen result arrays, caller inputs never
 * mutated.
 *
 * @module @borjie/central-intelligence/kernel/intent-verification
 */

// ---------------------------------------------------------------------------
// Port types (duck-typed against autonomy-governance's IntentVerdict)
// ---------------------------------------------------------------------------

/** Per-session frame the verifier reads for context-aware rules. */
export interface IntentVerifierSessionContext {
  readonly recentTools: ReadonlyArray<string>;
  readonly recentTopics: ReadonlyArray<string>;
  readonly escalationCount: number;
  readonly orgId?: string;
  readonly tenantId?: string;
  readonly userId?: string;
}

/** The verification input for a single proposed tool call. */
export interface IntentVerifierRequest {
  readonly toolName: string;
  readonly toolArgs: Readonly<Record<string, unknown>>;
  readonly userMessage: string;
  readonly sessionContext: IntentVerifierSessionContext;
}

/** Verdict shape — structurally compatible with autonomy-governance. */
export interface IntentVerifierVerdict {
  readonly permitted: boolean;
  readonly confidence: number;
  readonly reason: string;
  readonly matchedRule?: string;
}

/**
 * The injected port. A single synchronous (or async) function that the
 * composition root binds to autonomy-governance `verifyIntent`. Async is
 * allowed so a future Layer-B LLM judge can drop in without an interface
 * change.
 */
export interface IntentVerifierPort {
  verify(
    req: IntentVerifierRequest,
  ): IntentVerifierVerdict | Promise<IntentVerifierVerdict>;
}

// ---------------------------------------------------------------------------
// Inputs / outputs of the kernel-side gate
// ---------------------------------------------------------------------------

export interface ProposedToolCall {
  readonly toolName: string;
  readonly input: unknown;
  readonly callId?: string;
}

export interface VerifyToolCallsArgs {
  readonly verifier: IntentVerifierPort | undefined;
  /** Master flag. When false the gate is a pass-through no-op. */
  readonly enabled: boolean;
  readonly proposed: ReadonlyArray<ProposedToolCall>;
  readonly userMessage: string;
  readonly sessionContext: IntentVerifierSessionContext;
}

export interface ToolCallVerdict {
  readonly toolName: string;
  readonly callId?: string;
  readonly permitted: boolean;
  readonly reason: string;
  readonly matchedRule?: string;
  /** True when the verifier threw and we fail-safe-allowed the call. */
  readonly verifierErrored: boolean;
}

export interface VerifyToolCallsResult {
  /** Calls cleared for dispatch (input shape preserved for the dispatcher). */
  readonly allowed: ReadonlyArray<ProposedToolCall>;
  /** Calls blocked by a `permitted:false` verdict. */
  readonly blocked: ReadonlyArray<ToolCallVerdict>;
  /** Per-call verdicts in input order (for the decision trace). */
  readonly verdicts: ReadonlyArray<ToolCallVerdict>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Coerce arbitrary tool input into the `Record<string, unknown>` the
 * verifier expects. Non-object inputs (string, number, array, null) are
 * wrapped under a `value` key so injection patterns hiding in a scalar arg
 * are still scanned.
 */
function toArgsRecord(input: unknown): Readonly<Record<string, unknown>> {
  if (
    input !== null &&
    typeof input === 'object' &&
    !Array.isArray(input)
  ) {
    return input as Readonly<Record<string, unknown>>;
  }
  return Object.freeze({ value: input });
}

const PASS_THROUGH_REASON = 'intent-verification disabled or unwired';

function passThrough(
  proposed: ReadonlyArray<ProposedToolCall>,
): VerifyToolCallsResult {
  const verdicts = proposed.map((c) =>
    Object.freeze({
      toolName: c.toolName,
      ...(c.callId !== undefined ? { callId: c.callId } : {}),
      permitted: true,
      reason: PASS_THROUGH_REASON,
      verifierErrored: false,
    }),
  );
  return Object.freeze({
    allowed: Object.freeze([...proposed]),
    blocked: Object.freeze([]),
    verdicts: Object.freeze(verdicts),
  });
}

// ---------------------------------------------------------------------------
// Public gate
// ---------------------------------------------------------------------------

/**
 * Verify every proposed tool call against the user ask. Returns the subset
 * cleared for dispatch plus the per-call verdicts. NEVER throws.
 *
 * The gate is fail-OPEN on verifier *errors* (an internal verifier bug must
 * not brick the brain) but fail-CLOSED on explicit `permitted:false`
 * verdicts (a matched rule is a real safety signal and is honoured).
 */
export async function verifyToolCalls(
  args: VerifyToolCallsArgs,
): Promise<VerifyToolCallsResult> {
  if (!args.enabled || args.verifier === undefined || args.proposed.length === 0) {
    return passThrough(args.proposed);
  }

  const allowed: ProposedToolCall[] = [];
  const blocked: ToolCallVerdict[] = [];
  const verdicts: ToolCallVerdict[] = [];

  for (const call of args.proposed) {
    let verdict: ToolCallVerdict;
    try {
      const raw = await args.verifier.verify({
        toolName: call.toolName,
        toolArgs: toArgsRecord(call.input),
        userMessage: args.userMessage,
        sessionContext: args.sessionContext,
      });
      verdict = Object.freeze({
        toolName: call.toolName,
        ...(call.callId !== undefined ? { callId: call.callId } : {}),
        permitted: raw.permitted === true,
        reason: typeof raw.reason === 'string' ? raw.reason : '',
        ...(raw.matchedRule !== undefined
          ? { matchedRule: raw.matchedRule }
          : {}),
        verifierErrored: false,
      });
    } catch (err) {
      // Fail-OPEN on internal verifier errors: allow the call so a
      // verifier bug never blocks the hot path, but flag it.
      verdict = Object.freeze({
        toolName: call.toolName,
        ...(call.callId !== undefined ? { callId: call.callId } : {}),
        permitted: true,
        reason: `intent-verifier error (fail-open): ${
          err instanceof Error ? err.message : String(err)
        }`,
        verifierErrored: true,
      });
    }

    verdicts.push(verdict);
    if (verdict.permitted) {
      allowed.push(call);
    } else {
      blocked.push(verdict);
    }
  }

  return Object.freeze({
    allowed: Object.freeze(allowed),
    blocked: Object.freeze(blocked),
    verdicts: Object.freeze(verdicts),
  });
}
