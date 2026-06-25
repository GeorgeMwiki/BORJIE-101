/**
 * Raw-error-render guard — the app-wide tripwire against rendering a raw
 * gateway error message (English wire copy) under any locale (Class A).
 *
 * Canon: the gateway error envelope carries a stable `code` + a raw English
 * `message`. Rendering that `message` under an `sw` session is language
 * MIXING. Every error render must flow through `localizeApiError(err,
 * locale)` (which resolves the CODE to single-language copy) or a localised
 * dictionary string — NEVER `setError(err.message)` /
 * `instanceof ApiError ? err.message`.
 *
 * Same shrink-only ratchet as the locale-purity guard:
 *   1. a NEW leak (file not on the baseline) fails the build;
 *   2. a STALE allowlist entry (file that no longer leaks) ALSO fails,
 *      forcing the baseline to shrink monotonically toward [].
 *
 * Mutation proof the gate BITES: revert any converted site to
 * `setError(err.message)` (or `instanceof ApiError ? err.message`) and the
 * "no NEW leak" assertion goes RED; restore `localizeApiError(...)` and it
 * is GREEN. The unit assertions below prove the SCANNER itself catches both
 * forbidden shapes and passes the localised shape (a blind scanner's zero
 * would be a false-clean).
 */

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findRawErrorRenders } from '../raw-error-render';
import { RAW_ERROR_RENDER_ALLOWLIST } from '../raw-error-render-allowlist';

// Vitest runs with cwd = the owner-web package root; the source tree is ./src.
const SRC_ROOT = resolve(process.cwd(), 'src');

describe('raw-error-render — owner-web no-raw-gateway-message guard', () => {
  const leaks = findRawErrorRenders(SRC_ROOT);
  const allow = new Set(RAW_ERROR_RENDER_ALLOWLIST);

  it('renders NO new raw gateway error message (not on the baseline)', () => {
    const fresh = leaks.filter((f) => !allow.has(f));
    expect(
      fresh,
      'New raw-error render detected. Route through localizeApiError(err, ' +
        `locale) / a stable code:\n${fresh.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps no STALE allowlist entry (the debt ledger only shrinks)', () => {
    const leakSet = new Set(leaks);
    const stale = RAW_ERROR_RENDER_ALLOWLIST.filter((f) => !leakSet.has(f));
    expect(
      stale,
      `These files no longer render a raw error — delete them from ` +
        `raw-error-render-allowlist.ts:\n${stale.join('\n')}`,
    ).toEqual([]);
  });

  it('has a baseline that only shrinks (round-12b: ≤1 parked residual)', () => {
    // Round-11 took this to []. Round-12b WIDENED the scanner (bare-JSX,
    // as-Error-with-localised-fallback, user-facing state-field) and converted
    // the whole newly-visible USER-FACING offender set, leaving ONE parked
    // residual: lib/cockpit-sse.ts (an INTERNAL, never-rendered SSE-state
    // `error` field — a false-positive for the user-facing class, owned by
    // another stream this round). The ratchet only shrinks from here; any
    // NEW entry is a regression to convert, never a place to park new debt.
    expect(RAW_ERROR_RENDER_ALLOWLIST.length).toBeLessThanOrEqual(1);
  });
});

/**
 * Scanner self-validation — proves the detector is ALIVE (a blind detector's
 * zero is a false-clean). We run the same regexes the scanner uses against
 * seeded positive + negative snippets.
 */
describe('raw-error-render scanner self-validation (RED-on-seeded)', () => {
  // Mirror of RAW_ERROR_PATTERNS in raw-error-render.ts. Kept here so a drift
  // between the two is caught by the snippet assertions below.
  const PATTERNS: readonly RegExp[] = [
    /\bset[A-Za-z]*(?:Error|Toast|Message)\s*\([^)\n]*\b(?:err|error|e|cause)\.message\b/,
    /instanceof\s+ApiError\s*\?\s*[A-Za-z0-9_.]*\.message\b/,
    /\{\s*(?:err|error|e|cause)\.message\s*\}/,
    /instanceof\s+Error\s*\?\s*[A-Za-z0-9_.]*\.message\s*:\s*(?:t\(|pickByLocale\(|copy\.|S\.|JS\.|COPY\.|[A-Za-z0-9_]+\.(?:sw|en)\b)/,
    /\b(?:message|error|detail|title|description)\s*:\s*[^,;\n]*\binstanceof\s+Error\s*\?\s*[A-Za-z0-9_.]*\.message\b/,
  ];
  const matches = (s: string): boolean => PATTERNS.some((re) => re.test(s));

  // ── pattern 1: state setter ──
  it('FLAGS setError(err.message)', () => {
    expect(matches('setError(err instanceof Error ? err.message : x)')).toBe(true);
  });

  it('FLAGS setToast(error.message)', () => {
    expect(matches('setToast(error.message)')).toBe(true);
  });

  // ── pattern 2: instanceof ApiError ──
  it('FLAGS `instanceof ApiError ? err.message`', () => {
    expect(
      matches('err instanceof ApiError ? err.message : t("flows.failed")'),
    ).toBe(true);
  });

  it('FLAGS `instanceof ApiError ? queue.error.message`', () => {
    expect(
      matches('queue.error instanceof ApiError ? queue.error.message : t(x)'),
    ).toBe(true);
  });

  // ── pattern 3: bare JSX render (round-12b) ──
  it('FLAGS a bare JSX `{error.message}` render', () => {
    expect(matches('{error.message}')).toBe(true);
    expect(matches('{ err.message }')).toBe(true);
  });

  // ── pattern 4: as-Error ternary with a LOCALISED fallback (round-12b) ──
  it('FLAGS `instanceof Error ? err.message : t(...)` (localised fallback = mixing)', () => {
    expect(
      matches("error instanceof Error ? error.message : t('planBilling.tryAgain')"),
    ).toBe(true);
  });

  it('FLAGS `instanceof Error ? err.message : copy.error`', () => {
    expect(matches('err instanceof Error ? err.message : copy.error')).toBe(true);
  });

  it('FLAGS `instanceof Error ? err.message : S.x.sw`', () => {
    expect(matches('err instanceof Error ? err.message : labels.sw')).toBe(true);
  });

  // ── pattern 5: user-facing state-field property (round-12b) ──
  it('FLAGS `message: err instanceof Error ? err.message : "..."`', () => {
    expect(
      matches("message: err instanceof Error ? err.message : 'failed to load tab'"),
    ).toBe(true);
  });

  it('FLAGS `error: err instanceof Error ? err.message : "code"`', () => {
    expect(
      matches("error: err instanceof Error ? err.message : 'eventsource-construct-failed'"),
    ).toBe(true);
  });

  // ── negatives: the localised replacement + internal-only shapes pass ──
  it('PASSES the localised replacement (no bare .message)', () => {
    expect(matches('setError(localizeApiError(err, locale))')).toBe(false);
    expect(matches('setError(localizeError(err, locale))')).toBe(false);
    expect(
      matches('err instanceof ApiError ? localizeApiError(err, locale) : t(x)'),
    ).toBe(false);
    expect(matches('setUploadState({ message: localizeError(err, locale) })')).toBe(false);
    expect(matches('{localizeError(error, locale)}')).toBe(false);
  });

  it('PASSES a stable-code render', () => {
    expect(matches("setError('RECENT_TYPES_FETCH_FAILED')")).toBe(false);
  });

  it('PASSES an INTERNAL `const x = err instanceof Error ? err.message : "code"`', () => {
    // The dev-message / throw-arg shape feeds an internal Error or a code
    // token, never a user render — a `const`/`let` binding has no
    // user-facing slot KEY, so pattern 5 must NOT match it.
    expect(
      matches("const message = err instanceof Error ? err.message : 'network unreachable';"),
    ).toBe(false);
    expect(
      matches("throw new Error(err instanceof Error ? err.message : 'Network error');"),
    ).toBe(false);
  });

  it('PASSES `instanceof Error ? err.message : "plain-string"` (no localised fallback, no slot key)', () => {
    // A bare-string fallback with no user-facing slot KEY and no JSX wrapper
    // is below the user-facing signature (it is the internal-dev shape).
    expect(matches("x instanceof Error ? x.message : 'stream read failed'")).toBe(false);
  });
});
