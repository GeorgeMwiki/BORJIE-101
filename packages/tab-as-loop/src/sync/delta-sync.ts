/**
 * Client → server delta sync.
 *
 * Wave M5. §16 of the spec.
 *
 * The sync contract:
 *   - Client posts an ordered batch of `TabDelta` with a
 *     `fromIteration` cursor.
 *   - Server validates each delta, applies in order to the canonical
 *     `TabState`, and persists each as a `TabEvent`.
 *   - If `fromIteration` is behind the server, the server returns a
 *     `rebase` snapshot — the client re-applies its local deltas on
 *     top of the authoritative state.
 *
 * The function here is pure: it takes the current session + the
 * deltas, returns the next session + the persisted events. The
 * caller (a service-layer adapter) wires this into the repository
 * write path.
 */

import type {
  ApplyDeltasInput,
  ApplyDeltasResult,
  TabDelta,
  TabEvent,
  TabSession,
  TabState,
} from '../types.js';
import { TAB_AS_LOOP_CONSTANTS } from '../types.js';
import { computeTabAuditHash } from '../audit/audit-chain-link.js';

export class DeltaSyncError extends Error {
  public readonly code:
    | 'too_many_deltas'
    | 'unknown_kind'
    | 'invalid_payload'
    | 'lifecycle_not_warm';
  constructor(code: DeltaSyncError['code'], message: string) {
    super(message);
    this.name = 'DeltaSyncError';
    this.code = code;
  }
}

interface ApplyDeltasDeps {
  readonly now: () => Date;
  /** Inject random uuid generation for deterministic tests. */
  readonly nextId: () => string;
}

/**
 * Apply an ordered batch of deltas to a session. Returns the next
 * session + the events that should be persisted. If the client cursor
 * is behind the server, returns a `rebase` snapshot so the client can
 * redo its local turn. No mutation: same input → same output.
 */
export function applyDeltas(
  current: TabSession,
  input: ApplyDeltasInput,
  deps: ApplyDeltasDeps,
): ApplyDeltasResult {
  if (current.lifecycleState !== 'active' && current.lifecycleState !== 'paused') {
    throw new DeltaSyncError(
      'lifecycle_not_warm',
      `applyDeltas requires warm session (active|paused); got ${current.lifecycleState}`,
    );
  }
  if (input.deltas.length > TAB_AS_LOOP_CONSTANTS.MAX_DELTAS_PER_APPLY) {
    throw new DeltaSyncError(
      'too_many_deltas',
      `deltas.length=${input.deltas.length} exceeds MAX_DELTAS_PER_APPLY=${TAB_AS_LOOP_CONSTANTS.MAX_DELTAS_PER_APPLY}`,
    );
  }

  // Rebase detection — if the client thinks it's at iteration N but
  // the server is at M > N, we need to send the server snapshot back
  // and ask the client to re-apply. We do not persist anything in
  // that case.
  if (input.fromIteration < current.state.loopCursor.iteration) {
    return {
      session: current,
      persistedEvents: [],
      rebase: current.state,
    };
  }

  let nextState: TabState = current.state;
  let prevHash = current.auditHash;
  const events: TabEvent[] = [];
  const now = deps.now();

  for (const delta of input.deltas) {
    validateDelta(delta);
    nextState = reduceState(nextState, delta);
    const iteration = nextState.loopCursor.iteration;
    const auditHash = computeTabAuditHash(
      {
        op: 'tab_event',
        sessionId: current.id,
        tenantId: input.tenantId,
        eventKind: delta.kind,
        iteration,
        payload: delta.payload,
        recordedAtMs: now.getTime(),
      },
      prevHash,
    );
    const event: TabEvent = Object.freeze({
      id: deps.nextId(),
      tabSessionId: current.id,
      tenantId: input.tenantId,
      eventKind: delta.kind,
      iteration,
      payload: delta.payload,
      recordedAt: now,
      auditHash,
    });
    events.push(event);
    prevHash = auditHash;
  }

  const nextSession: TabSession = Object.freeze({
    ...current,
    state: nextState,
    auditHash: prevHash,
    prevHash: current.auditHash,
  });

  return {
    session: nextSession,
    persistedEvents: Object.freeze(events.slice()),
    rebase: null,
  };
}

// ---------------------------------------------------------------------------
// Reducer — pure state evolution per delta kind.
// ---------------------------------------------------------------------------

function reduceState(state: TabState, delta: TabDelta): TabState {
  const nextIteration = state.loopCursor.iteration + 1;
  switch (delta.kind) {
    case 'ui.field-edit': {
      const next: Record<string, unknown> = {
        ...state.uiState,
        ...(delta.payload as Record<string, unknown>),
      };
      return {
        ...state,
        uiState: next,
        loopCursor: { ...state.loopCursor, iteration: nextIteration },
      };
    }
    case 'loop.iteration-done': {
      const verdict = (delta.payload['verdict'] as 'allow' | 'deny' | 'review' | undefined) ?? 'allow';
      const lastSensorAt = (delta.payload['at'] as string | undefined) ?? new Date(0).toISOString();
      return {
        ...state,
        loopCursor: {
          iteration: nextIteration,
          lastSensorAt,
          lastPolicyVerdict: verdict,
        },
      };
    }
    case 'hint.acknowledge': {
      const hintId = delta.payload['hintId'] as string | undefined;
      const acknowledgedAt = (delta.payload['at'] as string | undefined) ?? new Date(0).toISOString();
      const pendingHints = state.pendingHints.map((h) =>
        h.hintId === hintId ? { ...h, acknowledged: true, emittedAt: acknowledgedAt } : h,
      );
      return {
        ...state,
        pendingHints,
        loopCursor: { ...state.loopCursor, iteration: nextIteration },
      };
    }
    case 'friction.sample': {
      const delta01 = Number(delta.payload['score'] ?? 0);
      const samples = state.frictionLedger.samples + 1;
      const score =
        (state.frictionLedger.score * state.frictionLedger.samples + clamp01(delta01)) / samples;
      return {
        ...state,
        frictionLedger: { score, samples },
        loopCursor: { ...state.loopCursor, iteration: nextIteration },
      };
    }
    case 'recipe.proposal': {
      const proposalId = String(delta.payload['proposalId'] ?? '');
      const recipeProposals = proposalId.length === 0
        ? state.recipeProposals
        : [...state.recipeProposals, proposalId];
      return {
        ...state,
        recipeProposals,
        loopCursor: { ...state.loopCursor, iteration: nextIteration },
      };
    }
    case 'lifecycle.transition': {
      return {
        ...state,
        loopCursor: { ...state.loopCursor, iteration: nextIteration },
      };
    }
    default: {
      const exhaustive: never = delta.kind;
      throw new DeltaSyncError(
        'unknown_kind',
        `unknown delta kind ${String(exhaustive)}`,
      );
    }
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function validateDelta(delta: TabDelta): void {
  if (delta.payload === null || typeof delta.payload !== 'object') {
    throw new DeltaSyncError('invalid_payload', 'delta.payload must be an object');
  }
  if (!Number.isFinite(delta.clientIteration) || delta.clientIteration < 0) {
    throw new DeltaSyncError(
      'invalid_payload',
      'delta.clientIteration must be a non-negative number',
    );
  }
}
