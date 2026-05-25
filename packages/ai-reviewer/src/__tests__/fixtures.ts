/**
 * Shared fixtures for policy tests.
 *
 * Each fixture is the smallest payload that drives a particular branch
 * of the policy under test. Keep fixtures isolated per test file
 * unless the shape is genuinely shared (like ReviewContext) — that way
 * a fixture change does not silently break tests in unrelated files.
 */

import type { ReviewContext, WorkflowKind, PolicyRequest } from '../types.js';

export const ctx: ReviewContext = Object.freeze({
  tenantId: 'tenant_test',
  actorUserId: 'user_test',
  actorRole: 'property_manager',
  submittedAt: '2026-05-24T12:00:00.000Z',
  correlationId: 'corr_test',
});

export function makeReq(
  kind: WorkflowKind,
  payload: Readonly<Record<string, unknown>>,
  overrides?: Partial<ReviewContext>,
): PolicyRequest<Readonly<Record<string, unknown>>> {
  return {
    kind,
    payload,
    context: { ...ctx, ...(overrides ?? {}) },
  };
}
