/**
 * useAffectiveProfile — React hook that exposes the brain's affective /
 * Theory-of-Mind profile to the chat UI.
 *
 * The central-intelligence kernel attaches an `affectiveProfile` block on
 * `BrainResponse.metadata` whenever the Theory-of-Mind sub-personality has
 * enough signal to estimate the user's emotional state. The shape mirrors
 * the kernel's `AffectiveProfile` type:
 *
 *   {
 *     frustration: number;     // 0..1
 *     comprehension: number;   // 0..1  (higher = better understanding)
 *     anxiety: number;         // 0..1
 *     trust: number;           // 0..1
 *     urgency: number;         // 0..1
 *     lastUpdated: string;     // ISO timestamp
 *   }
 *
 * The hook reads the latest profile from a getter callback (so it can be
 * wired to any source — useChatStream state, a context, an SSE listener)
 * and enforces a 1-minute TTL: once `lastUpdated` is older than `ttlMs`
 * the hook returns null so consumers stop surfacing stale hints.
 *
 * Duplicated locally rather than imported from `@borjie/central-intelligence`
 * — chat-ui must not depend on the kernel package; the contract is
 * validated by Theory-of-Mind kernel tests.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Affective profile shape mirroring the kernel's Theory-of-Mind output.
 * Numeric fields are normalised to the unit interval [0, 1].
 */
export interface AffectiveProfile {
  readonly frustration: number;
  readonly comprehension: number;
  readonly anxiety: number;
  readonly trust: number;
  readonly urgency: number;
  readonly lastUpdated: string;
}

/**
 * Default TTL after which a profile is considered stale and the hook
 * returns null. One minute matches the kernel's ToM refresh cadence.
 */
export const DEFAULT_AFFECTIVE_TTL_MS = 60_000;

export interface UseAffectiveProfileOptions {
  /**
   * Getter callback returning the latest brain response metadata's
   * `affectiveProfile`. Returning `null`/`undefined` means "no signal".
   * The callback is invoked on each `pollMs` tick and whenever the hook
   * is asked to refresh.
   */
  readonly getProfile: () => AffectiveProfile | null | undefined;
  /**
   * Stale-state TTL in milliseconds. Default 60s.
   */
  readonly ttlMs?: number;
  /**
   * Optional poll interval (ms) to re-read the getter. Default 5000.
   * Set to 0 to disable polling — useful in tests / SSR.
   */
  readonly pollMs?: number;
  /**
   * Clock injection seam for tests. Defaults to `Date.now`.
   */
  readonly now?: () => number;
}

/**
 * Returns the freshest non-stale affective profile, or null when no
 * signal exists / the latest signal has expired.
 */
export function useAffectiveProfile(
  options: UseAffectiveProfileOptions,
): AffectiveProfile | null {
  const {
    getProfile,
    ttlMs = DEFAULT_AFFECTIVE_TTL_MS,
    pollMs = 5_000,
    now = Date.now,
  } = options;

  const getProfileRef = useRef(getProfile);
  getProfileRef.current = getProfile;
  const nowRef = useRef(now);
  nowRef.current = now;

  const computeFresh = useCallback((): AffectiveProfile | null => {
    const candidate = getProfileRef.current();
    if (!candidate) return null;
    return isFresh(candidate, ttlMs, nowRef.current) ? candidate : null;
  }, [ttlMs]);

  const [profile, setProfile] = useState<AffectiveProfile | null>(() =>
    computeFresh(),
  );

  // Re-evaluate freshness whenever the polling tick fires OR when the
  // consumer's `refresh()` is called. Polling is opt-out via pollMs=0.
  useEffect(() => {
    let cancelled = false;

    const tick = (): void => {
      if (cancelled) return;
      const next = computeFresh();
      setProfile((prev) => (shallowEqual(prev, next) ? prev : next));
    };

    // Run an initial tick so a profile that became fresh between render
    // and effect fires is captured.
    tick();

    if (pollMs <= 0) return () => {
      cancelled = true;
    };

    const handle = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [computeFresh, pollMs]);

  return profile;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for test reuse)
// ---------------------------------------------------------------------------

/**
 * Returns true when `profile.lastUpdated` is within `ttlMs` of the
 * current time. Invalid timestamps are treated as stale (return false)
 * — better to silently drop than show wrong hints.
 */
export function isFresh(
  profile: AffectiveProfile,
  ttlMs: number,
  now: () => number = Date.now,
): boolean {
  const updatedAt = Date.parse(profile.lastUpdated);
  if (Number.isNaN(updatedAt)) return false;
  return now() - updatedAt <= ttlMs;
}

/**
 * Shallow equality for two profiles — used to avoid setState churn when
 * polling returns the same numbers. Both null is equal.
 */
function shallowEqual(
  a: AffectiveProfile | null,
  b: AffectiveProfile | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.frustration === b.frustration &&
    a.comprehension === b.comprehension &&
    a.anxiety === b.anxiety &&
    a.trust === b.trust &&
    a.urgency === b.urgency &&
    a.lastUpdated === b.lastUpdated
  );
}
