/**
 * RTBF orchestrator — drives the lifecycle of an `rtbf_requests` row.
 *
 * Lifecycle:
 *
 *   open → in-progress → completed
 *        ↘ denied
 *        ↘ expired
 *
 * The orchestrator is a pure state machine; the persistence layer is
 * injected via a port so tests can run against an in-memory store and
 * production runs against Postgres + the schema in migration 0053.
 *
 * Hash-chained audit: each row's `audit_hash` chains over the previous
 * row's `audit_hash` (`prev_hash` column). The chain head is the empty
 * string for the first state in a request.
 */

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import {
  DataProtectionInvariantError,
  type RtbfStatus,
} from '../types.js';
import type { RtbfCascadePlan } from './cascade-planner.js';

export interface RtbfRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly requestedAt: Date;
  readonly status: RtbfStatus;
  readonly denialReason: string | null;
  readonly completedAt: Date | null;
  readonly prevHash: string;
  readonly auditHash: string;
}

function hashState(input: {
  readonly id: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly status: RtbfStatus;
  readonly denialReason: string | null;
  readonly completedAt: Date | null;
  readonly prevHash: string;
}): string {
  return bytesToHex(
    sha256(
      utf8ToBytes(
        [
          input.id,
          input.tenantId,
          input.subjectId,
          input.status,
          input.denialReason ?? '',
          input.completedAt ? input.completedAt.toISOString() : '',
          input.prevHash,
        ].join('|'),
      ),
    ),
  );
}

const ALLOWED_TRANSITIONS: Readonly<Record<RtbfStatus, ReadonlySet<RtbfStatus>>> =
  Object.freeze({
    open: new Set<RtbfStatus>(['in-progress', 'denied', 'expired']),
    'in-progress': new Set<RtbfStatus>(['completed', 'denied', 'expired']),
    completed: new Set<RtbfStatus>(),
    denied: new Set<RtbfStatus>(),
    expired: new Set<RtbfStatus>(),
  });

export function openRequest(input: {
  readonly id: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly requestedAt: Date;
}): RtbfRequest {
  const prevHash = '';
  const auditHash = hashState({
    id: input.id,
    tenantId: input.tenantId,
    subjectId: input.subjectId,
    status: 'open',
    denialReason: null,
    completedAt: null,
    prevHash,
  });
  return Object.freeze({
    id: input.id,
    tenantId: input.tenantId,
    subjectId: input.subjectId,
    requestedAt: input.requestedAt,
    status: 'open',
    denialReason: null,
    completedAt: null,
    prevHash,
    auditHash,
  });
}

export function transition(input: {
  readonly request: RtbfRequest;
  readonly to: RtbfStatus;
  readonly denialReason?: string;
  readonly completedAt?: Date;
}): RtbfRequest {
  const { request, to } = input;
  const allowed = ALLOWED_TRANSITIONS[request.status];
  if (!allowed || !allowed.has(to)) {
    throw new DataProtectionInvariantError(
      'rtbf.illegal_transition',
      `Cannot move RTBF request from ${request.status} → ${to}.`,
    );
  }
  if (to === 'denied' && (input.denialReason === undefined || input.denialReason === '')) {
    throw new DataProtectionInvariantError(
      'rtbf.denial_requires_reason',
      'Denial transition requires a non-empty denialReason.',
    );
  }
  if (to === 'completed' && input.completedAt === undefined) {
    throw new DataProtectionInvariantError(
      'rtbf.completed_requires_timestamp',
      'Completed transition requires a completedAt timestamp.',
    );
  }
  const denialReason = to === 'denied' ? (input.denialReason ?? null) : null;
  const completedAt = to === 'completed' ? (input.completedAt ?? null) : null;
  const prevHash = request.auditHash;
  const auditHash = hashState({
    id: request.id,
    tenantId: request.tenantId,
    subjectId: request.subjectId,
    status: to,
    denialReason,
    completedAt,
    prevHash,
  });
  return Object.freeze({
    id: request.id,
    tenantId: request.tenantId,
    subjectId: request.subjectId,
    requestedAt: request.requestedAt,
    status: to,
    denialReason,
    completedAt,
    prevHash,
    auditHash,
  });
}

/** Verify that the chain (open → ... → terminal) is unbroken. */
export function verifyAuditChain(states: ReadonlyArray<RtbfRequest>): boolean {
  if (states.length === 0) {
    return true;
  }
  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    if (!state) {
      return false;
    }
    const prev = i === 0 ? '' : (states[i - 1]?.auditHash ?? '');
    if (state.prevHash !== prev) {
      return false;
    }
    const recomputed = hashState({
      id: state.id,
      tenantId: state.tenantId,
      subjectId: state.subjectId,
      status: state.status,
      denialReason: state.denialReason,
      completedAt: state.completedAt,
      prevHash: state.prevHash,
    });
    if (recomputed !== state.auditHash) {
      return false;
    }
  }
  return true;
}

/** Check SLA: an open / in-progress request older than `slaDays` is expired. */
export function isExpired(input: {
  readonly request: RtbfRequest;
  readonly slaDays: number;
  readonly now: Date;
}): boolean {
  if (input.request.status === 'completed' || input.request.status === 'denied') {
    return false;
  }
  const ageMs = input.now.getTime() - input.request.requestedAt.getTime();
  return ageMs > input.slaDays * 24 * 60 * 60 * 1000;
}

// Re-export the plan type for convenience.
export type { RtbfCascadePlan };
