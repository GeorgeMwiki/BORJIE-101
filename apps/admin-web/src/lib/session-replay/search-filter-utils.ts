/**
 * Session-replay viewer search + filter utilities — Central Command
 * Phase C (C4). Pure functions so the unit tests stay deterministic
 * and the React components stay declarative.
 *
 * The session-replay landing page hosts a list of `RecentSession`
 * tuples fetched from the gateway. The filter chain is:
 *
 *   sessions
 *     → filterSessions(query)        // free-text across id/user/surface
 *     → applyFacets({date, errors, duration})
 *
 * Both passes are pure and immutable. The list is filtered client-
 * side because the gateway returns at most 500 sessions per window —
 * server-side facet queries would just trade simplicity for latency.
 */

export interface RecentSessionLike {
  readonly sessionId: string;
  readonly userId: string;
  readonly surface: string;
  readonly firstCapturedAt: string;
  readonly lastCapturedAt: string;
  readonly chunkCount: number;
  /** Optional — populated by the sensorium overlay when available. */
  readonly errorEventCount?: number;
  /** Optional tenant display name when the row carries a joined column. */
  readonly tenantName?: string;
}

export type DateFacet = 'all' | '1h' | '24h' | '7d' | '30d';
export type DurationFacet = 'all' | 'under-1m' | '1-5m' | 'over-5m';
export type ErrorFacet = 'all' | 'with-errors' | 'no-errors';

export interface FacetState {
  readonly date: DateFacet;
  readonly errors: ErrorFacet;
  readonly duration: DurationFacet;
}

export const DEFAULT_FACET_STATE: FacetState = {
  date: 'all',
  errors: 'all',
  duration: 'all',
};

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Free-text filter — case-insensitive substring match against
 * `sessionId`, `userId`, `surface`, and (when present) `tenantName`.
 * Empty / whitespace-only queries return the input unchanged.
 */
export function filterSessions<T extends RecentSessionLike>(
  sessions: ReadonlyArray<T>,
  query: string,
): ReadonlyArray<T> {
  if (!sessions || sessions.length === 0) return sessions ?? [];
  const trimmed = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (trimmed.length === 0) return sessions;
  return sessions.filter((s) => {
    if (!s) return false;
    if (matches(s.sessionId, trimmed)) return true;
    if (matches(s.userId, trimmed)) return true;
    if (matches(s.surface, trimmed)) return true;
    if (s.tenantName && matches(s.tenantName, trimmed)) return true;
    return false;
  });
}

/**
 * Facet filter — composes the three independent dimensions
 * (date / errors / duration). Each dimension defaults to `'all'`.
 */
export function applyFacets<T extends RecentSessionLike>(
  sessions: ReadonlyArray<T>,
  facets: FacetState,
  now: number = Date.now(),
): ReadonlyArray<T> {
  if (!sessions || sessions.length === 0) return sessions ?? [];
  const f = normaliseFacets(facets);
  if (
    f.date === 'all' &&
    f.errors === 'all' &&
    f.duration === 'all'
  ) {
    return sessions;
  }
  return sessions.filter((s) => {
    if (!s) return false;
    if (!matchesDate(s, f.date, now)) return false;
    if (!matchesErrors(s, f.errors)) return false;
    if (!matchesDuration(s, f.duration)) return false;
    return true;
  });
}

/**
 * Convenience pipeline: search + facets composed in one call. Pure.
 */
export function searchAndFilter<T extends RecentSessionLike>(
  sessions: ReadonlyArray<T>,
  query: string,
  facets: FacetState,
  now: number = Date.now(),
): ReadonlyArray<T> {
  return applyFacets(filterSessions(sessions, query), facets, now);
}

/**
 * Compute session duration in ms from the first→last captured-at
 * timestamps. Returns 0 when either side is malformed.
 */
export function sessionDurationMs(s: RecentSessionLike): number {
  const first = parseEpoch(s.firstCapturedAt);
  const last = parseEpoch(s.lastCapturedAt);
  if (first === null || last === null) return 0;
  const ms = last - first;
  return ms > 0 ? ms : 0;
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

function matches(haystack: string | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle);
}

function normaliseFacets(facets: FacetState | undefined | null): FacetState {
  if (!facets) return DEFAULT_FACET_STATE;
  return {
    date: facets.date ?? 'all',
    errors: facets.errors ?? 'all',
    duration: facets.duration ?? 'all',
  };
}

function matchesDate(
  s: RecentSessionLike,
  facet: DateFacet,
  now: number,
): boolean {
  if (facet === 'all') return true;
  const last = parseEpoch(s.lastCapturedAt);
  if (last === null) return false;
  const age = now - last;
  if (age < 0) return false;
  if (facet === '1h') return age <= MS_PER_HOUR;
  if (facet === '24h') return age <= 24 * MS_PER_HOUR;
  if (facet === '7d') return age <= 7 * MS_PER_DAY;
  if (facet === '30d') return age <= 30 * MS_PER_DAY;
  return true;
}

function matchesErrors(s: RecentSessionLike, facet: ErrorFacet): boolean {
  if (facet === 'all') return true;
  const count = Number.isFinite(s.errorEventCount) ? (s.errorEventCount as number) : 0;
  if (facet === 'with-errors') return count > 0;
  if (facet === 'no-errors') return count === 0;
  return true;
}

function matchesDuration(
  s: RecentSessionLike,
  facet: DurationFacet,
): boolean {
  if (facet === 'all') return true;
  const dur = sessionDurationMs(s);
  if (facet === 'under-1m') return dur < MS_PER_MINUTE;
  if (facet === '1-5m') return dur >= MS_PER_MINUTE && dur <= 5 * MS_PER_MINUTE;
  if (facet === 'over-5m') return dur > 5 * MS_PER_MINUTE;
  return true;
}

function parseEpoch(iso: string | undefined): number | null {
  if (!iso || typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}
