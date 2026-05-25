/**
 * lifecycle.ts — module state machine.
 *
 * States: DRAFT → PROPOSED → APPROVED → LIVE → DEPRECATED → ARCHIVED
 *
 * Transition rules:
 *   DRAFT → PROPOSED   — spec compiled successfully
 *   PROPOSED → APPROVED — K5 four-eye approved (hitl_approval_id present)
 *   APPROVED → LIVE    — applied migration succeeded
 *   LIVE → DEPRECATED  — admin opt-in (no four-eye required)
 *   DEPRECATED → ARCHIVED — final terminal; row read-only
 *
 * Roll-back edges:
 *   PROPOSED → DRAFT       — spec rejected or pulled by author
 *   APPROVED → PROPOSED    — approval revoked before apply
 *
 * The module-orchestrator NEVER allows a transition outside this graph.
 */

export const MODULE_LIFECYCLE_STATES = [
  'DRAFT',
  'PROPOSED',
  'APPROVED',
  'LIVE',
  'DEPRECATED',
  'ARCHIVED',
] as const;

export type ModuleLifecycleState =
  (typeof MODULE_LIFECYCLE_STATES)[number];

/** Allowed forward + roll-back edges. */
const TRANSITIONS: ReadonlyMap<
  ModuleLifecycleState,
  ReadonlyArray<ModuleLifecycleState>
> = new Map<ModuleLifecycleState, ReadonlyArray<ModuleLifecycleState>>([
  ['DRAFT', ['PROPOSED']],
  ['PROPOSED', ['APPROVED', 'DRAFT']],
  ['APPROVED', ['LIVE', 'PROPOSED']],
  ['LIVE', ['DEPRECATED']],
  ['DEPRECATED', ['ARCHIVED']],
  ['ARCHIVED', []],
]);

export interface LifecycleTransitionRequest {
  readonly from: ModuleLifecycleState;
  readonly to: ModuleLifecycleState;
  readonly hitlApprovalId?: string | null;
}

export interface LifecycleTransitionResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/**
 * Check whether a transition is permitted by the state machine.
 *
 * Side conditions (encoded here so callers can't bypass them):
 *   - PROPOSED → APPROVED ALWAYS requires a non-empty hitlApprovalId.
 *   - All other transitions ignore hitlApprovalId.
 *
 * Returns `{ ok: false, errors: [...] }` on rejection.
 */
export function canTransition(
  req: LifecycleTransitionRequest,
): LifecycleTransitionResult {
  const allowed = TRANSITIONS.get(req.from);
  if (!allowed) {
    return {
      ok: false,
      errors: [`unknown source state: ${req.from}`],
    };
  }
  if (!allowed.includes(req.to)) {
    return {
      ok: false,
      errors: [`forbidden transition ${req.from} → ${req.to}`],
    };
  }
  if (req.from === 'PROPOSED' && req.to === 'APPROVED') {
    if (!req.hitlApprovalId || req.hitlApprovalId.length === 0) {
      return {
        ok: false,
        errors: [
          'PROPOSED → APPROVED requires a non-empty hitlApprovalId (K5 four-eye)',
        ],
      };
    }
  }
  return { ok: true, errors: [] };
}

/**
 * Return the list of states reachable in one transition from {state}.
 */
export function reachableStates(
  state: ModuleLifecycleState,
): readonly ModuleLifecycleState[] {
  return TRANSITIONS.get(state) ?? [];
}

/**
 * True iff a state is a terminal node (no outbound transitions).
 */
export function isTerminal(state: ModuleLifecycleState): boolean {
  const next = TRANSITIONS.get(state);
  return !next || next.length === 0;
}
