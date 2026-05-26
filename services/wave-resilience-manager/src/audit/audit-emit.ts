/**
 * Audit-hash helper — wraps `@borjie/audit-hash-chain` for the
 * resilience manager.
 *
 * Every state transition + every recorded attempt seals into the
 * audit chain. The chain itself is held in-memory by the caller and
 * persisted via the repositories' `audit_hash` columns.
 */

import { hashChainEntry, type AuditPayload } from '@borjie/audit-hash-chain';

export interface AuditableEvent {
  readonly kind:
    | 'wave.progress'
    | 'wave.crashed'
    | 'wave.revivable'
    | 'wave.resuming'
    | 'wave.completed'
    | 'wave.unrecoverable'
    | 'attempt.recorded'
    | 'attempt.outcome';
  readonly wave_id: string;
  readonly seq?: number;
  readonly extra?: Record<string, unknown>;
  readonly at_iso?: string;
}

export interface AuditChainState {
  readonly previousHash: string | null;
}

export interface AuditChainTransition {
  readonly nextHash: string;
  readonly payload: AuditPayload;
}

/**
 * Pure — given the previous chain hash, return the new hash for an
 * event. Callers persist `nextHash` alongside the new row, then pass
 * `nextHash` as `previousHash` on the next call.
 */
export function sealEvent(
  state: AuditChainState,
  event: AuditableEvent,
): AuditChainTransition {
  const payload: AuditPayload = {
    kind: event.kind,
    wave_id: event.wave_id,
    ...(event.seq !== undefined ? { seq: event.seq } : {}),
    ...(event.extra !== undefined ? { extra: event.extra } : {}),
    at: event.at_iso ?? new Date().toISOString(),
  };
  const nextHash = hashChainEntry({
    ...(state.previousHash !== null ? { prev: state.previousHash } : {}),
    payload,
  });
  return { nextHash, payload };
}
