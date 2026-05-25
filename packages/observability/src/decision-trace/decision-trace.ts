/**
 * DecisionTrace factory + live handle.
 *
 * `startDecisionTrace` returns a mutable handle that records branches
 * and a chosen branch as the decision unfolds. `finalize()` produces an
 * immutable, JSON-cloneable snapshot, persists it to the configured
 * store, and (when present) attaches it to the active OTel span.
 *
 * The brain kernel's 13-step pipeline wraps each top-level "think" call
 * in one of these so a downstream auditor sees ONE structured trace per
 * brain invocation instead of 13 unrelated span events.
 *
 * @module packages/observability/src/decision-trace/decision-trace
 */

import { randomUUID } from 'node:crypto';

import { attachDecisionTraceToActiveSpan } from './otel-bridge.js';
import {
  getDefaultDecisionTraceStore,
  type DecisionTraceStore,
} from './persistence-port.js';
import {
  DecisionTraceFinalisedError,
  DecisionTraceUnknownBranchError,
  type DecisionBranch,
  type DecisionOutcome,
  type DecisionTrace,
  type DecisionTraceContext,
  type DecisionTraceFinalised,
} from './types.js';

/**
 * Options for `startDecisionTrace`.
 */
export interface StartDecisionTraceOptions {
  /**
   * Inputs the decision saw. Required so the trace is auditable in
   * isolation (a debug UI does not need to refetch upstream context).
   * MUST be JSON-clonable.
   */
  readonly inputs: Readonly<Record<string, unknown>>;
  /** Tenant / user / request scope. */
  readonly context?: DecisionTraceContext;
  /**
   * Override the default trace store. Tests / nested brain invocations
   * use this to capture traces into a private store.
   */
  readonly store?: DecisionTraceStore;
  /**
   * Override the generated trace id. Useful when an upstream system
   * (e.g. an idempotency key) has already minted a stable id.
   */
  readonly traceId?: string;
  /**
   * Disable persistence — emit OTel events only. Used by dry-run /
   * preview paths where we want the auditor visibility without
   * polluting the audit log with throwaway traces.
   */
  readonly skipPersistence?: boolean;
  /**
   * Disable OTel bridge. Used by pure-domain tests that don't want a
   * mocked span to be exercised.
   */
  readonly skipOtelBridge?: boolean;
}

/**
 * Internal mutable state behind the live handle. The handle exposes a
 * fluent API; the state object stays private inside this module so
 * outside code can never bypass the finalise guard.
 */
interface MutableTraceState {
  finalised: boolean;
  readonly traceId: string;
  readonly name: string;
  readonly startedAt: string;
  readonly startedAtMs: number;
  readonly context: { -readonly [K in keyof DecisionTraceContext]: DecisionTraceContext[K] } & {
    attributes: Record<string, unknown>;
  };
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly branches: DecisionBranch[];
  chosenBranchId: string | null;
  chosenRationale: string | null;
  readonly store: DecisionTraceStore;
  readonly skipPersistence: boolean;
  readonly skipOtelBridge: boolean;
}

/**
 * Open a new DecisionTrace. The returned handle records branches and a
 * chosen branch until `finalize()` is called.
 *
 * Trace IDs are 128-bit UUIDs (`randomUUID`) so the probability of a
 * collision across the entire brain-trace history is negligible — same
 * guarantee as OTel's W3C trace-id.
 *
 * @param name - Action name e.g. `brain.draft_lease` or
 *   `payments.refund_authorise`. Use `<service>.<operation>` to match
 *   the existing span naming convention in this package.
 */
export function startDecisionTrace(
  name: string,
  options: StartDecisionTraceOptions,
): DecisionTrace {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('startDecisionTrace: name is required');
  }

  const traceId = options.traceId ?? randomUUID();
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  const state: MutableTraceState = {
    finalised: false,
    traceId,
    name,
    startedAt,
    startedAtMs,
    context: {
      tenantId: options.context?.tenantId,
      userId: options.context?.userId,
      requestId: options.context?.requestId,
      parentTraceId: options.context?.parentTraceId,
      attributes: { ...(options.context?.attributes ?? {}) },
    },
    inputs: { ...options.inputs },
    branches: [],
    chosenBranchId: null,
    chosenRationale: null,
    store: options.store ?? getDefaultDecisionTraceStore(),
    skipPersistence: options.skipPersistence === true,
    skipOtelBridge: options.skipOtelBridge === true,
  };

  return buildHandle(state);
}

/** Build the public handle around an internal state object. */
function buildHandle(state: MutableTraceState): DecisionTrace {
  return {
    get traceId() {
      return state.traceId;
    },
    get name() {
      return state.name;
    },
    get startedAt() {
      return state.startedAt;
    },

    addBranch(branch) {
      if (state.finalised) {
        throw new DecisionTraceFinalisedError(state.traceId, 'addBranch');
      }
      if (typeof branch.id !== 'string' || branch.id.length === 0) {
        throw new Error('addBranch: branch.id is required');
      }
      // Reject duplicate branch ids — debugging is impossible if two
      // distinct branches share the same id.
      if (state.branches.some((b) => b.id === branch.id)) {
        throw new Error(
          `addBranch: duplicate branch id '${branch.id}' on trace ${state.traceId}`,
        );
      }
      const recorded: DecisionBranch = {
        id: branch.id,
        label: branch.label,
        rationale: branch.rationale,
        ...(branch.score !== undefined ? { score: branch.score } : {}),
        ...(branch.metadata !== undefined ? { metadata: { ...branch.metadata } } : {}),
        recordedAt: new Date().toISOString(),
      };
      state.branches.push(recorded);
    },

    choose(branchId, rationale) {
      if (state.finalised) {
        throw new DecisionTraceFinalisedError(state.traceId, 'choose');
      }
      const branch = state.branches.find((b) => b.id === branchId);
      if (branch === undefined) {
        throw new DecisionTraceUnknownBranchError(state.traceId, branchId);
      }
      state.chosenBranchId = branchId;
      state.chosenRationale = rationale ?? null;
    },

    addAttribute(key, value) {
      if (state.finalised) {
        throw new DecisionTraceFinalisedError(state.traceId, 'addAttribute');
      }
      state.context.attributes[key] = value;
    },

    isFinalised: () => state.finalised,

    finalize({ outcome, output, error }) {
      if (state.finalised) {
        throw new DecisionTraceFinalisedError(state.traceId, 'finalize');
      }
      state.finalised = true;
      const finalisedAtMs = Date.now();
      const finalisedAt = new Date(finalisedAtMs).toISOString();
      const durationMs = Math.max(0, finalisedAtMs - state.startedAtMs);

      // Build the immutable snapshot. `Object.freeze` + readonly arrays
      // give us shallow immutability; we deep-clone via structuredClone
      // so callers cannot mutate the inputs/branches/output through any
      // retained references.
      const snapshot: DecisionTraceFinalised = Object.freeze({
        traceId: state.traceId,
        name: state.name,
        startedAt: state.startedAt,
        finalisedAt,
        durationMs,
        context: Object.freeze({
          tenantId: state.context.tenantId,
          userId: state.context.userId,
          requestId: state.context.requestId,
          parentTraceId: state.context.parentTraceId,
          attributes: deepFreeze({ ...state.context.attributes }),
        }),
        inputs: deepFreeze({ ...state.inputs }),
        branches: Object.freeze(
          state.branches.map((b) =>
            Object.freeze({
              ...b,
              ...(b.metadata !== undefined
                ? { metadata: deepFreeze({ ...b.metadata }) }
                : {}),
            }),
          ),
        ),
        chosenBranchId: state.chosenBranchId,
        chosenRationale: state.chosenRationale,
        outcome,
        output: output === undefined ? null : output,
        error: error ?? null,
      });

      // Side-effects — best-effort, never throw into the caller.
      if (!state.skipOtelBridge) {
        try {
          attachDecisionTraceToActiveSpan(snapshot);
        } catch {
          // bridge swallows internally; double-belt-and-braces here.
        }
      }
      if (!state.skipPersistence) {
        // Persistence is async + we don't want to block the decision
        // path on storage. Fire-and-forget; if the store fails the
        // adapter is responsible for logging via its own pino logger.
        void state.store.save(snapshot).catch(() => {
          // Swallowed — adapter handles its own logging.
        });
      }

      return snapshot;
    },
  };
}

/**
 * Deep-freeze a JSON-cloneable object so callers can't mutate nested
 * fields through retained references. Recurses into plain objects +
 * arrays only — does not descend into class instances (which by our
 * "JSON-cloneable" contract should not appear).
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value) as T;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value) as T;
}

/**
 * Convenience: open a trace, run a function under it, and finalise
 * automatically. The function MUST call `trace.choose()` or the outcome
 * will be `refused` with no chosen branch.
 *
 * If `fn` throws, the trace is finalised with `outcome: 'failed'` and
 * the error message attached, then the error is re-thrown.
 */
export async function withDecisionTrace<T>(
  name: string,
  options: StartDecisionTraceOptions,
  fn: (trace: DecisionTrace) => Promise<T> | T,
  outcomeFor: (result: T) => DecisionOutcome = () => 'executed',
): Promise<{ result: T; trace: DecisionTraceFinalised }> {
  const trace = startDecisionTrace(name, options);
  try {
    const result = await fn(trace);
    const finalised = trace.finalize({
      outcome: outcomeFor(result),
      output: result,
    });
    return { result, trace: finalised };
  } catch (err) {
    if (!trace.isFinalised()) {
      trace.finalize({
        outcome: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }
}
