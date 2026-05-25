/**
 * Case State Machine
 *
 * Defines legal transitions between CaseStatus values and provides
 * assertion helpers used by CaseService.transitionCase.
 *
 * Spec: Docs/analysis/SCAFFOLDED_COMPLETION.md §3.
 */

import type { Result } from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';

// ============================================================================
// Status list
// ============================================================================

export const CaseStatus = [
  'OPEN',
  'IN_PROGRESS',
  'PENDING_RESPONSE',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
] as const;

export type CaseStatusValue = (typeof CaseStatus)[number];

// ============================================================================
// Transition map
// ============================================================================

export const TRANSITIONS: Readonly<Record<CaseStatusValue, readonly CaseStatusValue[]>> = {
  OPEN: ['IN_PROGRESS', 'PENDING_RESPONSE', 'ESCALATED', 'CLOSED'],
  IN_PROGRESS: ['PENDING_RESPONSE', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  PENDING_RESPONSE: ['IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  ESCALATED: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
} as const;

// ============================================================================
// Errors
// ============================================================================

export interface IllegalTransitionError {
  readonly code: 'ILLEGAL_TRANSITION';
  readonly from: CaseStatusValue;
  readonly to: CaseStatusValue;
  readonly message: string;
}

// ============================================================================
// API
// ============================================================================

export function canTransition(from: CaseStatusValue, to: CaseStatusValue): boolean {
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function assertTransition(
  from: CaseStatusValue,
  to: CaseStatusValue
): Result<void, IllegalTransitionError> {
  if (!canTransition(from, to)) {
    return err({
      code: 'ILLEGAL_TRANSITION',
      from,
      to,
      message: `Illegal case status transition: ${from} -> ${to}`,
    });
  }
  return ok(undefined as void);
}
