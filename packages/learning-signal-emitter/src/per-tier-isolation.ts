/**
 * Per-tier isolation gate.
 *
 * The single choke point EVERY learning signal passes through before it
 * touches a persistence layer / a sink. The gate enforces:
 *
 *   1. User-scoped signals never bleed into other users.
 *   2. Org-scoped signals never cross tenant boundaries.
 *   3. Platform-wide rollups only happen behind k-anonymity (k >= 25).
 *
 * PURE function over the signal + the cohort size. Returns `{ ok: true }`
 * or `{ ok: false, reason }`. Callers MUST refuse to fan out on ok=false.
 *
 * Ported from LITFIN learning/per-tier-isolation.ts.
 */

import type { LearningSignal, TenantScope } from './types.js';

/** Minimum cohort size before a signal may aggregate to platform scope. */
export const DEFAULT_K_ANONYMITY = 25;

export interface IsolationCheckInput {
  readonly signal: LearningSignal;
  /**
   * Distinct users contributing to this signal's cohort (platform only).
   * `| undefined` so callers may forward an optional value directly under
   * exactOptionalPropertyTypes.
   */
  readonly cohortSize?: number | undefined;
  /** Override the k-anonymity threshold for testing. */
  readonly kAnonymity?: number | undefined;
}

export type IsolationResult =
  | { readonly ok: true; readonly scope: TenantScope }
  | { readonly ok: false; readonly reason: string };

/**
 * Enforce per-tier isolation. PURE.
 *   - 'user'     requires subjectUserId set, subjectOrgId unset.
 *   - 'org'      requires subjectOrgId set, subjectUserId unset.
 *   - 'platform' requires both null AND cohortSize >= kAnonymity.
 */
export function enforceIsolation(input: IsolationCheckInput): IsolationResult {
  const k = input.kAnonymity ?? DEFAULT_K_ANONYMITY;
  const s = input.signal;
  switch (s.tenantScope) {
    case 'user':
      if (!s.subjectUserId) {
        return { ok: false, reason: 'user-scoped signal missing subjectUserId' };
      }
      if (s.subjectOrgId) {
        return {
          ok: false,
          reason: 'user-scoped signal must not carry subjectOrgId',
        };
      }
      return { ok: true, scope: 'user' };
    case 'org':
      if (!s.subjectOrgId) {
        return { ok: false, reason: 'org-scoped signal missing subjectOrgId' };
      }
      if (s.subjectUserId) {
        return {
          ok: false,
          reason: 'org-scoped signal must not carry subjectUserId',
        };
      }
      return { ok: true, scope: 'org' };
    case 'platform':
      if (s.subjectUserId || s.subjectOrgId) {
        return {
          ok: false,
          reason:
            'platform-scoped signal must not carry subjectUserId or subjectOrgId',
        };
      }
      if ((input.cohortSize ?? 0) < k) {
        return {
          ok: false,
          reason: `platform-scoped signal needs cohort >= ${k} (got ${input.cohortSize ?? 0})`,
        };
      }
      return { ok: true, scope: 'platform' };
  }
}

/** Convenience predicate. True when the signal is allowed to fan out. */
export function isolationAllowed(input: IsolationCheckInput): boolean {
  return enforceIsolation(input).ok;
}
