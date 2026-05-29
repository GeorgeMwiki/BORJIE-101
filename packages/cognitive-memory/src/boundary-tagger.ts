/**
 * Boundary tagger — Chinese-wall filter for the person-layer / tenant-
 * layer composition in the Brain query planner.
 *
 * Closes G5 in `Docs/AUDIT/RESEARCH_GAPS_2026-05-29.md` — wires the
 * cross-tenant numeric-synthesis guard researched in
 * `Docs/RESEARCH/unified-personal-kb.md` §3.3 + §5 + §10.6.
 *
 *   "Counts and existence-claims about cross-tenant data are allowed;
 *    specific numbers, specific entity names, specific decisions are
 *    not. Counts get k-anonymised (k ≥ 3) when cross-org."
 *
 * Two callers consume this module:
 *
 *   1. The brain's memory query planner — after pulling both tenant-
 *      scope and person-scope cells, it tags every retrieved chunk
 *      with `origin` and then passes the bag through
 *      `filterByActiveTenant()` to drop anything whose origin is
 *      another tenant.
 *
 *   2. The brain's reply composer — before returning the LLM output
 *      to the user, it calls `assertNoCrossTenantNumeric()` against
 *      the candidate text + the active tenant + the bag of contributing
 *      origins. If the text mentions a number that traces back to a
 *      different tenant, the assertion throws (fail-closed).
 *
 * The module is pure — no DB access, no network, no logger. It is
 * deterministic given its inputs and trivially testable.
 *
 * NOT a replacement for the existing tenant-RLS GUC; this is a
 * second-line defence at the reply-composition layer. The first line
 * (the RLS predicate on `cognitive_memory_cells.tenant_id`) is still
 * the source of truth.
 */

// ---------------------------------------------------------------------------
// Origin tagging
// ---------------------------------------------------------------------------

/**
 * Origin of a single memory chunk inside the brain's working bag.
 *
 *   - `tenant.<id>`         — pulled from a tenant-scoped table; visible
 *                              only when `<id> === active tenant`.
 *   - `person.public`       — pulled from `personal_memory_cells` with
 *                              `scope='public'`. Always visible.
 *   - `person.role.<t>.<r>` — pulled from `personal_memory_cells` with
 *                              `scope='role'|'role-private'`; visible
 *                              only when the active tenant + role match.
 *   - `platform`            — pulled from `platform_memory_cells`
 *                              (cross-tenant by design). Always visible.
 */
export type ChunkOrigin =
  | { readonly kind: 'tenant'; readonly tenantId: string }
  | { readonly kind: 'person.public' }
  | { readonly kind: 'person.role'; readonly tenantId: string; readonly role: string }
  | { readonly kind: 'platform' }

export interface TaggedChunk<T> {
  readonly origin: ChunkOrigin
  readonly chunk: T
}

export interface ActiveContext {
  readonly tenantId: string
  /**
   * The role the user is currently wearing inside `tenantId` — eg
   * 'owner', 'manager'. Used to gate person.role chunks. Optional —
   * when undefined, person.role chunks are always dropped.
   */
  readonly role?: string
}

// ---------------------------------------------------------------------------
// Filter — drops cross-tenant chunks
// ---------------------------------------------------------------------------

/**
 * Keep only chunks visible to the active context. Pure function — the
 * input array is never mutated.
 *
 * Visibility rules:
 *
 *   - tenant.X         → keep iff X === ctx.tenantId
 *   - person.public    → always keep
 *   - person.role.X.R  → keep iff X === ctx.tenantId AND R === ctx.role
 *   - platform         → always keep
 */
export function filterByActiveContext<T>(
  chunks: ReadonlyArray<TaggedChunk<T>>,
  ctx: ActiveContext,
): ReadonlyArray<TaggedChunk<T>> {
  return chunks.filter((c) => isVisible(c.origin, ctx))
}

function isVisible(origin: ChunkOrigin, ctx: ActiveContext): boolean {
  switch (origin.kind) {
    case 'tenant':
      return origin.tenantId === ctx.tenantId
    case 'person.public':
      return true
    case 'person.role':
      return origin.tenantId === ctx.tenantId && origin.role === ctx.role
    case 'platform':
      return true
  }
}

// ---------------------------------------------------------------------------
// Numeric-synthesis guard
// ---------------------------------------------------------------------------

/**
 * Result of a numeric-synthesis check on candidate LLM output.
 *
 *   - `ok: true`  — no cross-tenant numeric leak detected.
 *   - `ok: false` — at least one number in the candidate text appears
 *                    in a chunk whose origin is a non-active tenant.
 *                    The reply composer MUST reject the candidate
 *                    (fail-closed per CLAUDE.md hard rule).
 */
export interface CrossTenantSynthesisCheck {
  readonly ok: boolean
  readonly violations: ReadonlyArray<{
    readonly number: string
    readonly foreignTenantId: string
  }>
}

// Match digit-led runs that may include thousands separators (commas)
// and a single decimal point with at least one trailing digit. Trailing
// suffixes like "M"/"B"/"k" are not part of the number; the pattern
// stops at the last digit. We use a non-greedy decimal so "2.5M" yields
// "2.5" rather than "2." (the suffix is unrelated to the value).
const NUMBER_PATTERN = /\d[\d,]*(?:\.\d+)?/g

/**
 * Returns the set of numbers (as raw strings) the candidate text would
 * surface to the user. Exported for testing + reuse.
 */
export function extractCandidateNumbers(text: string): ReadonlyArray<string> {
  const matches = text.match(NUMBER_PATTERN)
  if (matches === null) return []
  // De-duplicate while preserving order — the violation report is
  // easier to read if numbers appear in document order.
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of matches) {
    if (!seen.has(m)) {
      seen.add(m)
      out.push(m)
    }
  }
  return out
}

/**
 * Fail-closed cross-tenant numeric-synthesis guard.
 *
 * Walks every number in `candidateText` and asks: "does any chunk
 * whose origin is a NON-active tenant contain this number?". If yes,
 * the reply would leak a cross-tenant fact and the check fails.
 *
 * Counts and existence-claims still pass — eg "Across the 3 mines you
 * own, you made 12 decisions this week" surfaces small integers that
 * exist independently in every tenant's view. The cross-tenant rule
 * trips when a number visible only inside Mine A appears in a reply
 * the user reads from Mine B.
 *
 * @param candidateText The LLM output about to be shown to the user.
 * @param contributingChunks Every chunk that contributed to the reply
 *   (the union of chunks the planner pulled, BEFORE
 *   `filterByActiveContext`). Each must carry its origin tag.
 * @param ctx The active context (tenant + role).
 */
export function checkCrossTenantNumericSynthesis<T extends { readonly text: string }>(
  candidateText: string,
  contributingChunks: ReadonlyArray<TaggedChunk<T>>,
  ctx: ActiveContext,
): CrossTenantSynthesisCheck {
  const numbers = extractCandidateNumbers(candidateText)
  if (numbers.length === 0) {
    return Object.freeze({ ok: true, violations: [] })
  }
  const foreignTenantChunks = contributingChunks.filter(
    (c) => c.origin.kind === 'tenant' && c.origin.tenantId !== ctx.tenantId,
  )
  if (foreignTenantChunks.length === 0) {
    return Object.freeze({ ok: true, violations: [] })
  }
  const violations: Array<{ number: string; foreignTenantId: string }> = []
  for (const num of numbers) {
    for (const chunk of foreignTenantChunks) {
      if (chunk.chunk.text.includes(num)) {
        // origin must be 'tenant' by the filter above — narrow the type.
        if (chunk.origin.kind === 'tenant') {
          violations.push({ number: num, foreignTenantId: chunk.origin.tenantId })
        }
      }
    }
  }
  return Object.freeze({
    ok: violations.length === 0,
    violations,
  })
}

/**
 * Thin wrapper that throws on violation — the reply composer can call
 * this in places where rejection is meant to halt the turn. Mirrors
 * the kill-switch fail-closed posture.
 */
export class CrossTenantNumericSynthesisError extends Error {
  readonly violations: CrossTenantSynthesisCheck['violations']
  constructor(check: CrossTenantSynthesisCheck) {
    super(
      `cross-tenant numeric synthesis blocked (${check.violations.length} violation${
        check.violations.length === 1 ? '' : 's'
      })`,
    )
    this.name = 'CrossTenantNumericSynthesisError'
    this.violations = check.violations
  }
}

export function assertNoCrossTenantNumeric<T extends { readonly text: string }>(
  candidateText: string,
  contributingChunks: ReadonlyArray<TaggedChunk<T>>,
  ctx: ActiveContext,
): void {
  const check = checkCrossTenantNumericSynthesis(candidateText, contributingChunks, ctx)
  if (!check.ok) {
    throw new CrossTenantNumericSynthesisError(check)
  }
}

// ---------------------------------------------------------------------------
// k-anonymisation for cross-tenant counts
// ---------------------------------------------------------------------------

/**
 * Default k-anonymity threshold per
 * `Docs/RESEARCH/unified-personal-kb.md` §3.3. Counts below this are
 * suppressed to avoid re-identifying a single tenant from the count.
 */
export const DEFAULT_K_ANONYMITY = 3

export interface KAnonymisedCount {
  readonly ok: boolean
  readonly count: number | null
  readonly suppressed: boolean
}

/**
 * Returns a count safe to display in a cross-tenant context. When the
 * raw count is below `k`, the count is suppressed (null) — the caller
 * MUST render a fallback message ("Insufficient data to display").
 */
export function kAnonymisedCount(
  rawCount: number,
  k: number = DEFAULT_K_ANONYMITY,
): KAnonymisedCount {
  if (!Number.isFinite(rawCount) || rawCount < 0) {
    return Object.freeze({ ok: false, count: null, suppressed: false })
  }
  if (rawCount < k) {
    return Object.freeze({ ok: true, count: null, suppressed: true })
  }
  return Object.freeze({ ok: true, count: rawCount, suppressed: false })
}
