/**
 * four-eye-gate.ts — HARD RULE 3: irreversible-class four-eye gating.
 *
 * Spawning a tenant module executes generated DDL against the live
 * tenant DB — an IRREVERSIBLE-class action. Before any apply, a valid
 * second-admin four-eye approval MUST exist. This module is a thin,
 * PURE predicate over the EXISTING `createApprovalGate` engine's record
 * shape (`@borjie/central-intelligence` four-eye-approval). It does
 * NOT mint approvals, does NOT auto-approve, and does NOT mark the
 * approval executed (that is the apply pass's job via
 * `ApprovalGate.markExecuted`).
 *
 * `assertApplyApproved` re-derives the separation-of-duties invariant
 * itself rather than trusting the port — defence in depth:
 *
 *   1. status === 'approved'
 *   2. action is a module-spawn / irreversible-class action
 *   3. proposer is NOT among the approvers (proposer != every approver)
 *   4. ≥1 distinct approver who actually signed 'approve'
 *   5. the approval is BOUND to this exact spec's SQL hash
 *      (`payload.specSqlHash` === expected) so a stale approval for a
 *      different spec cannot be replayed onto new DDL
 *   6. NOT already executed (one-shot — the apply pass flips it)
 *
 * Pure. No I/O.
 */

/**
 * The minimal slice of the central-intelligence ApprovalRecord this
 * gate reads. Declared structurally (not imported) so the pure guard
 * package has ZERO runtime dependency on central-intelligence — the
 * caller adapts the real record to this shape at the (later) wiring
 * pass. This keeps Pass 1 dependency-free and unit-testable.
 */
export interface FourEyeApprovalView {
  readonly action: {
    readonly id: string;
    readonly proposerUserId: string;
    readonly toolName: string;
    readonly tenantId?: string | null;
    readonly payload: Readonly<Record<string, unknown>>;
  };
  readonly status: string;
  readonly signatures: ReadonlyArray<{
    readonly approverUserId: string;
    readonly verdict: 'approve' | 'reject';
  }>;
  readonly executed: boolean;
}

export interface AssertApplyApprovedInput {
  readonly tenantId: string;
  readonly moduleId: string;
  readonly specId: string;
  /** Deterministic hash of the exact spec SQL the apply will execute. */
  readonly specSqlHash: string;
  /** The approval record the caller fetched from the four-eye store. */
  readonly approval: FourEyeApprovalView | null;
}

export interface AssertApplyApprovedResult {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<string>;
}

/**
 * The tool names that count as a module-spawn / irreversible-class
 * action. The approval MUST have been proposed against one of these so
 * an approval minted for an unrelated low-stakes action cannot be
 * repurposed to authorise DDL execution.
 */
export const MODULE_SPAWN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'module.spawn',
  'module.apply',
  'module.apply_migration',
  'modules.apply_spec',
]);

export function assertApplyApproved(
  input: AssertApplyApprovedInput,
): AssertApplyApprovedResult {
  const errors: string[] = [];
  const { approval } = input;

  if (!approval) {
    return fail([
      'four-eye: no approval record found for this (module, spec) — refusing apply',
    ]);
  }

  // 1. Must be fully approved.
  if (approval.status !== 'approved') {
    errors.push(`four-eye: approval status is '${approval.status}', not 'approved'`);
  }

  // 2. Must be a module-spawn / irreversible-class action.
  if (!MODULE_SPAWN_TOOL_NAMES.has(approval.action.toolName)) {
    errors.push(
      `four-eye: approval toolName '${approval.action.toolName}' is not a module-spawn action`,
    );
  }

  // 3. tenant scope must match.
  const approvalTenant = approval.action.tenantId ?? null;
  if (approvalTenant !== input.tenantId) {
    errors.push(
      `four-eye: approval tenant '${String(approvalTenant)}' != apply tenant '${input.tenantId}'`,
    );
  }

  // 4. Separation of duties — proposer must not be any approver, and
  //    there must be ≥1 distinct approving signature.
  const approverIds = approval.signatures
    .filter((s) => s.verdict === 'approve')
    .map((s) => s.approverUserId);
  const distinctApprovers = new Set(approverIds);
  if (distinctApprovers.size === 0) {
    errors.push('four-eye: no approving signature present');
  }
  if (distinctApprovers.has(approval.action.proposerUserId)) {
    errors.push(
      'four-eye: proposer is also an approver (self-approval forbidden — proposer != approver)',
    );
  }

  // 5. Binding — the approval must reference THIS exact spec SQL hash,
  //    module, and spec so a stale/other-spec approval can't be replayed.
  const payload = approval.action.payload ?? {};
  const boundHash = readString(payload, 'specSqlHash');
  if (!boundHash) {
    errors.push('four-eye: approval payload missing specSqlHash binding');
  } else if (boundHash !== input.specSqlHash) {
    errors.push(
      'four-eye: approval specSqlHash does not match the spec being applied (stale/replayed approval)',
    );
  }
  const boundModule = readString(payload, 'moduleId');
  if (boundModule && boundModule !== input.moduleId) {
    errors.push('four-eye: approval moduleId does not match');
  }
  const boundSpec = readString(payload, 'specId');
  if (boundSpec && boundSpec !== input.specId) {
    errors.push('four-eye: approval specId does not match');
  }

  // 6. One-shot — not already executed.
  if (approval.executed === true) {
    errors.push('four-eye: approval already executed (one-shot consumed — replay refused)');
  }

  if (errors.length > 0) return fail(errors);
  return Object.freeze({ ok: true, errors: Object.freeze([]) });
}

function readString(
  obj: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function fail(errors: ReadonlyArray<string>): AssertApplyApprovedResult {
  return Object.freeze({ ok: false, errors: Object.freeze([...errors]) });
}
