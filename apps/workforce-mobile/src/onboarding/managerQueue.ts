/**
 * Workforce-mobile wire client for the manager onboarding review queue
 * (HR chain L-A, issue #193).
 *
 * Backs `app/(manager)/onboarding.tsx`. Talks to the api-gateway openings
 * router mounted at `/api/v1/workforce/openings`:
 *
 *   GET  /:id/candidates                     -> pending candidates per opening
 *   POST /:id/candidates/:userId/review      -> approve | reject a candidate
 *   GET  /                                   -> tenant openings (status filter)
 *
 * Uses the shared `request` wrapper in `../api/client` so bearer token,
 * timeout, and the ApiError envelope are handled identically to every
 * other surface. RLS auto-scopes every query to the caller's tenant.
 */

import { request, type RequestOptions } from '../api/client'
import { API_BASE_URL } from '../api/config'

const OPENINGS_BASE = `${API_BASE_URL}/api/v1/workforce/openings`

// `exactOptionalPropertyTypes` forbids passing `{ signal: undefined }`, so
// only attach the abort signal when the caller actually supplied one.
function withSignal(
  base: RequestOptions,
  signal?: AbortSignal,
): RequestOptions {
  return signal ? { ...base, signal } : base
}

export type CandidateDecision = 'approve' | 'reject'

interface Envelope<T> {
  readonly success: boolean
  readonly data?: T
  readonly error?: { readonly code?: string; readonly message?: string }
}

export interface OpeningRow {
  readonly id: string
  readonly title: string
  readonly status: string
}

export interface PendingCandidate {
  readonly id: string
  readonly displayName: string
  readonly openingId: string
  readonly openingTitle: string
  readonly activatedAt: string | null
}

/**
 * List every open opening for the current tenant. The manager queue fans
 * out from these to gather the per-opening candidate lists.
 */
export async function listOpenOpenings(
  signal?: AbortSignal,
): Promise<ReadonlyArray<OpeningRow>> {
  const response = await request<Envelope<ReadonlyArray<OpeningRow>>>(
    `${OPENINGS_BASE}?status=open`,
    withSignal({}, signal),
  )
  if (!response.success || !response.data) {
    throw new Error(response.error?.message ?? 'Failed to load openings')
  }
  return response.data
}

/**
 * List pending (activated, awaiting-review) candidates for one opening.
 */
export async function listCandidatesForOpening(
  openingId: string,
  signal?: AbortSignal,
): Promise<ReadonlyArray<PendingCandidate>> {
  const response = await request<Envelope<ReadonlyArray<PendingCandidate>>>(
    `${OPENINGS_BASE}/${encodeURIComponent(openingId)}/candidates`,
    withSignal({}, signal),
  )
  if (!response.success || !response.data) {
    throw new Error(response.error?.message ?? 'Failed to load candidates')
  }
  return response.data
}

/**
 * Aggregate the full manager review queue: every open opening's pending
 * candidates, flattened. Failures on a single opening are swallowed so a
 * stale/closed opening cannot blank the whole queue.
 */
export async function listPendingCandidates(
  signal?: AbortSignal,
): Promise<ReadonlyArray<PendingCandidate>> {
  const openings = await listOpenOpenings(signal)
  const settled = await Promise.allSettled(
    openings.map((opening) => listCandidatesForOpening(opening.id, signal)),
  )
  const out: PendingCandidate[] = []
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      out.push(...result.value)
    }
  }
  return out
}

/**
 * Approve or reject a candidate for an opening. `decision = 'approve'`
 * flips the worker to active and decrements the opening's count_needed;
 * `'reject'` flips the worker to rejected and leaves the count intact.
 */
export async function reviewCandidate(input: {
  readonly openingId: string
  readonly userId: string
  readonly decision: CandidateDecision
}): Promise<void> {
  const response = await request<Envelope<unknown>>(
    `${OPENINGS_BASE}/${encodeURIComponent(input.openingId)}/candidates/${encodeURIComponent(
      input.userId,
    )}/review`,
    { method: 'POST', body: { decision: input.decision } },
  )
  if (!response.success) {
    throw new Error(response.error?.message ?? 'Review failed')
  }
}
