/**
 * Body-change syscall — the ONE chokepoint for ALL self-change.
 *
 * This is the AIOS access-manager single chokepoint for the MD-as-Body
 * architecture (Docs/research/MD_AS_BODY_ARCHITECTURE.md §governance,
 * implementation-lane "Unify all body-change paths behind ONE
 * body-change syscall"). EVERY path that reshapes the MD's own body —
 * move/reorder a surface, add a surface or capability, edit a prompt or
 * tool-def, compose a new sub-MD, patch the self-model — MUST route
 * through `authorizeBodyChange`. It composes the three governance
 * primitives in lock-step:
 *
 *   1. `checkBodyChangeInviolable` — the deterministic, no-LLM,
 *      fail-closed META-RAIL (lives in `@borjie/central-intelligence`).
 *   2. `decideAutonomy`            — the continuous controller (lives in
 *      `@borjie/autonomy-governance`).
 *   3. `composeWithRail`           — the monotone-most-cautious combine
 *      with BOTH the existing rail stack AND the meta-rail outcome.
 *
 * Dependency discipline: `@borjie/mutation-authority` does NOT depend on
 * `central-intelligence` or `autonomy-governance` (that would create a
 * dependency edge / potential cycle). The three primitives are injected
 * as PORTS. The composition root wires the real implementations; tests
 * inject fakes. Either way the syscall is the single place where the
 * meta-rail, the controller, and the rail are guaranteed to run TOGETHER.
 *
 * ════════════════════════════════════════════════════════════════════
 * INVARIANTS (violation is a safety defect):
 * ════════════════════════════════════════════════════════════════════
 *   - FAIL-CLOSED: any missing port, any thrown port, any malformed
 *     verdict ⇒ the syscall DENIES (decision `four_eyes`, authorized
 *     `false`). The body-change NEVER proceeds on an evaluation failure.
 *   - RAIL-GATE ALWAYS WINS: the rail outcome is passed straight into
 *     `composeWithRail`; the syscall can only ADD gating on top, never
 *     remove it.
 *   - META-RAIL IS BINDING: a meta-rail `forbid` forces `four_eyes` and
 *     `authorized: false` — it can never be downgraded by the controller
 *     or the rail.
 *   - ADDITIVE: this module only ADDS a gate in front of execution; it
 *     does not weaken any existing mutation-authority invariant.
 */

// ---------------------------------------------------------------------------
// Lattice — local copy of the `auto < gate < four_eyes` escalation order.
// Kept local so this package needs no cross-package import for the rank.
// ---------------------------------------------------------------------------

export type BodyChangeAutonomyDecision = 'auto' | 'gate' | 'four_eyes';

export type BodyChangeRailOutcome = 'allow' | 'gate' | 'four_eyes';

export type BodyChangeMetaRailOutcome = 'allow' | 'forbid';

// ---------------------------------------------------------------------------
// Ports — the three governance primitives, injected.
// ---------------------------------------------------------------------------

/**
 * The META-RAIL port. The composition root binds
 * `checkBodyChangeInviolable` from `@borjie/central-intelligence`. The
 * argument is the opaque body-change descriptor; the return is the
 * collapsed verdict the syscall needs (`allow` | `forbid`).
 */
export interface MetaRailPort {
  /**
   * @param descriptor opaque body-change descriptor (the meta-rail owns
   *   its own structure). The syscall passes it through untouched.
   * @returns `{ status }` — `forbid` is binding.
   */
  readonly check: (descriptor: unknown) => { readonly status: 'allow' | 'forbid'; readonly reason?: string };
}

/** The continuous-controller port (binds `decideAutonomy`). */
export interface AutonomyControllerPort {
  readonly decide: (input: unknown) => {
    readonly decision: BodyChangeAutonomyDecision;
    readonly reasons: ReadonlyArray<string>;
    readonly gatedBy: string | null;
  };
}

/**
 * The compose-with-rail port (binds `composeWithRail`). The syscall
 * passes the rail outcome, the controller verdict, AND the meta-rail
 * outcome so the meta-rail participates in the monotone combine.
 */
export interface ComposeWithRailPort {
  readonly compose: (
    rail: BodyChangeRailOutcome,
    controller: {
      readonly decision: BodyChangeAutonomyDecision;
      readonly reasons: ReadonlyArray<string>;
      readonly gatedBy: string | null;
    },
    metaRail: BodyChangeMetaRailOutcome,
  ) => {
    readonly decision: BodyChangeAutonomyDecision;
    readonly reasons: ReadonlyArray<string>;
    readonly metaRailForbade: boolean;
    readonly railDominated: boolean;
  };
}

export interface BodyChangeSyscallPorts {
  readonly metaRail: MetaRailPort;
  readonly controller: AutonomyControllerPort;
  readonly composeWithRail: ComposeWithRailPort;
}

// ---------------------------------------------------------------------------
// Request + verdict
// ---------------------------------------------------------------------------

export interface BodyChangeRequest {
  /** Tenant scope of the body-change. */
  readonly tenantId: string;
  /** Stable id of the body node being changed (surface / sub-md / file). */
  readonly targetNodeId: string;
  /** Opaque descriptor handed verbatim to the meta-rail port. */
  readonly descriptor: unknown;
  /**
   * Collapsed verdict of the EXISTING rail stack (policy-gate /
   * inviolable / four-eye / kill-switch). RAIL-GATE ALWAYS WINS.
   */
  readonly railOutcome: BodyChangeRailOutcome;
  /** Inputs to the continuous controller (`decideAutonomy`). */
  readonly controllerInput: unknown;
}

export interface BodyChangeVerdict {
  /**
   * TRUE only when the change may proceed WITHOUT additional human
   * action — i.e. the composed decision is `auto`. Any gate / four_eyes
   * / meta-rail forbid / fail-closed ⇒ `false`.
   */
  readonly authorized: boolean;
  /** The composed, most-cautious decision. */
  readonly decision: BodyChangeAutonomyDecision;
  /** TRUE when the meta-rail forbade the change (binding). */
  readonly metaRailForbade: boolean;
  /** TRUE when the existing rail set/tied the final decision. */
  readonly railDominated: boolean;
  /** TRUE when the syscall failed closed (a port missing/threw/malformed). */
  readonly failedClosed: boolean;
  /** Ordered, audit-grade reasons. Never empty. */
  readonly reasons: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// The syscall
// ---------------------------------------------------------------------------

function denyClosed(reason: string): BodyChangeVerdict {
  return Object.freeze({
    authorized: false,
    decision: 'four_eyes' as const,
    metaRailForbade: false,
    railDominated: false,
    failedClosed: true,
    reasons: Object.freeze([`body-change-syscall: FAIL-CLOSED — ${reason}`]),
  });
}

/**
 * Authorize (or deny) a proposed body-change through the single
 * chokepoint. Runs the meta-rail, the controller, and the
 * compose-with-rail combine together. FAILS CLOSED on any error.
 *
 * This function is PURE relative to its ports: no I/O, no clock, no
 * mutation. The caller emits the audit entry (see
 * `runBodyChangeSyscall` for the audited variant).
 */
export function authorizeBodyChange(
  request: BodyChangeRequest,
  ports: BodyChangeSyscallPorts,
): BodyChangeVerdict {
  // Fail-closed shell — validate the request + ports BEFORE any call.
  if (
    !request ||
    typeof request.targetNodeId !== 'string' ||
    request.targetNodeId.length === 0
  ) {
    return denyClosed('malformed request (missing targetNodeId)');
  }
  if (
    request.railOutcome !== 'allow' &&
    request.railOutcome !== 'gate' &&
    request.railOutcome !== 'four_eyes'
  ) {
    return denyClosed(`invalid railOutcome '${String(request.railOutcome)}'`);
  }
  if (
    !ports ||
    typeof ports.metaRail?.check !== 'function' ||
    typeof ports.controller?.decide !== 'function' ||
    typeof ports.composeWithRail?.compose !== 'function'
  ) {
    return denyClosed('missing or invalid governance port(s)');
  }

  // 1. META-RAIL — deterministic, fail-closed.
  let metaRailOutcome: BodyChangeMetaRailOutcome;
  let metaRailReason: string | undefined;
  try {
    const verdict = ports.metaRail.check(request.descriptor);
    if (!verdict || (verdict.status !== 'allow' && verdict.status !== 'forbid')) {
      return denyClosed('meta-rail returned a malformed verdict');
    }
    metaRailOutcome = verdict.status;
    metaRailReason = verdict.reason;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return denyClosed(`meta-rail threw: ${message}`);
  }

  // 2. CONTROLLER — continuous autonomy recommendation.
  let controllerVerdict: {
    readonly decision: BodyChangeAutonomyDecision;
    readonly reasons: ReadonlyArray<string>;
    readonly gatedBy: string | null;
  };
  try {
    const verdict = ports.controller.decide(request.controllerInput);
    if (
      !verdict ||
      (verdict.decision !== 'auto' &&
        verdict.decision !== 'gate' &&
        verdict.decision !== 'four_eyes')
    ) {
      return denyClosed('controller returned a malformed verdict');
    }
    controllerVerdict = verdict;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return denyClosed(`controller threw: ${message}`);
  }

  // 3. COMPOSE — monotone-most-cautious over rail + controller + meta-rail.
  try {
    const composed = ports.composeWithRail.compose(
      request.railOutcome,
      controllerVerdict,
      metaRailOutcome,
    );
    if (
      !composed ||
      (composed.decision !== 'auto' &&
        composed.decision !== 'gate' &&
        composed.decision !== 'four_eyes')
    ) {
      return denyClosed('composeWithRail returned a malformed verdict');
    }

    // Defence-in-depth: the syscall asserts the post-conditions itself
    // rather than trusting the composer. A meta-rail forbid MUST mean
    // four_eyes; a rail four_eyes MUST mean four_eyes.
    if (metaRailOutcome === 'forbid' && composed.decision !== 'four_eyes') {
      return denyClosed(
        'meta-rail forbade but composer did not escalate to four_eyes',
      );
    }
    if (request.railOutcome === 'four_eyes' && composed.decision !== 'four_eyes') {
      return denyClosed('rail four_eyes but composer did not escalate');
    }
    if (request.railOutcome === 'gate' && composed.decision === 'auto') {
      return denyClosed('rail gate but composer downgraded to auto');
    }

    const reasons: string[] = [
      `body-change-syscall: target='${request.targetNodeId}'`,
      `meta-rail: ${metaRailOutcome}${metaRailReason ? ` (${metaRailReason})` : ''}`,
      ...composed.reasons,
      `body-change-syscall: final='${composed.decision}' authorized=${composed.decision === 'auto'}`,
    ];

    return Object.freeze({
      authorized: composed.decision === 'auto',
      decision: composed.decision,
      metaRailForbade: composed.metaRailForbade === true,
      railDominated: composed.railDominated === true,
      failedClosed: false,
      reasons: Object.freeze(reasons),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return denyClosed(`composeWithRail threw: ${message}`);
  }
}
