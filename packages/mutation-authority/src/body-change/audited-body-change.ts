/**
 * Audited body-change syscall — wraps `authorizeBodyChange` with a
 * hash-chained, append-only audit emission so EVERY self-change decision
 * (allow OR deny) lands in the sovereign-class ledger.
 *
 * This enforces the meta-rail's accountability clause (the antidote to
 * the 2025-AI-Agent-Index "accountability diffusion" finding): a
 * body-change is sovereign-class and MUST leave a hash-chained record.
 * The audit emission happens for BOTH outcomes — a denied / fail-closed
 * change is exactly the record an auditor most needs.
 *
 * Pure relative to its ports: the chain primitives come from
 * `@borjie/audit-hash-chain` (no I/O); the caller persists the returned
 * chain. The audit step NEVER suppresses or downgrades the verdict — if
 * the audit emission itself throws, the syscall FAILS CLOSED (a change
 * that cannot be audited must not proceed).
 */

import {
  appendEntry,
  type AuditPayload,
  type ChainEntry,
} from '@borjie/audit-hash-chain';
import {
  authorizeBodyChange,
  type BodyChangeRequest,
  type BodyChangeSyscallPorts,
  type BodyChangeVerdict,
} from './body-change-syscall.js';

export interface AuditedBodyChangeOutcome {
  readonly verdict: BodyChangeVerdict;
  /** The audit chain WITH the new body-change entry appended. */
  readonly chain: ReadonlyArray<ChainEntry>;
}

export interface AuditedBodyChangeArgs {
  readonly request: BodyChangeRequest;
  readonly ports: BodyChangeSyscallPorts;
  /** The prior audit chain to append onto. */
  readonly chain: ReadonlyArray<ChainEntry>;
  /** Actor proposing the change (for the ledger entry). */
  readonly proposer: string;
  readonly nowIso?: () => string;
}

function payloadFor(
  request: BodyChangeRequest,
  verdict: BodyChangeVerdict,
  proposer: string,
  atIso: string,
): AuditPayload {
  return {
    kind: 'body_change_decision',
    tenant_id: request.tenantId,
    target_node_id: request.targetNodeId,
    rail_outcome: request.railOutcome,
    decision: verdict.decision,
    authorized: verdict.authorized,
    meta_rail_forbade: verdict.metaRailForbade,
    rail_dominated: verdict.railDominated,
    failed_closed: verdict.failedClosed,
    proposer,
    decided_at: atIso,
  };
}

/**
 * Authorize a body-change AND append a hash-chained audit entry for the
 * decision. Returns both the verdict and the extended chain. The audit
 * emission is mandatory: if appending the entry throws, the syscall
 * fails closed (the verdict is forced to a denied / fail-closed shape).
 */
export function runAuditedBodyChange(
  args: AuditedBodyChangeArgs,
): AuditedBodyChangeOutcome {
  const nowIso = args.nowIso ?? (() => new Date().toISOString());
  const verdict = authorizeBodyChange(args.request, args.ports);

  try {
    const chain = appendEntry(
      args.chain,
      payloadFor(args.request, verdict, args.proposer, nowIso()),
    );
    return Object.freeze({ verdict, chain });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    // The change could not be audited → fail closed. Per the meta-rail's
    // no-audit-shortening clause, an unauditable change must not proceed.
    const deniedVerdict: BodyChangeVerdict = Object.freeze({
      authorized: false,
      decision: 'four_eyes' as const,
      metaRailForbade: verdict.metaRailForbade,
      railDominated: verdict.railDominated,
      failedClosed: true,
      reasons: Object.freeze([
        ...verdict.reasons,
        `audited-body-change: FAIL-CLOSED — audit emission threw: ${message}`,
      ]),
    });
    return Object.freeze({ verdict: deniedVerdict, chain: args.chain });
  }
}
