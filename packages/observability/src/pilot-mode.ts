/**
 * Pilot-mode observability flag.
 *
 * Background — during the 3-5 pilot cohort window (May-Jun 2026) Borjie
 * needs EVERY error captured automatically. Pilots cannot be relied upon
 * to remember what broke or to file tickets, so we run with a wider
 * Sentry sample (1.0) plus structured tags that let support correlate
 * an error back to the cohort/user without exposing PII.
 *
 * This module is the single source of truth for that switch. Three
 * surfaces consume it:
 *
 *   1. Server-side (api-gateway, workers) read `BORJIE_PILOT_MODE`.
 *   2. Web (owner-web, admin-web) read `NEXT_PUBLIC_BORJIE_PILOT_MODE`.
 *      Next.js injects `NEXT_PUBLIC_*` at build-time so the flag is
 *      visible from the browser bundle.
 *   3. Mobile (workforce-mobile, buyer-mobile) read
 *      `EXPO_PUBLIC_BORJIE_PILOT_MODE`. Expo follows the same prefix
 *      convention for build-time public flags.
 *
 * Detection is order-tolerant: callers can pass any subset of the three
 * names and the first truthy match wins. The default is "off" — if the
 * env is silent the platform behaves exactly as it did pre-pilot.
 *
 * Immutability — every helper returns a fresh object; we never mutate
 * the caller's context. This matches the project-wide rule documented in
 * `~/.claude/rules/coding-style.md`.
 *
 * No-op safety — the flag-detection code does not import Sentry. It only
 * builds the *context* objects that downstream Sentry wrappers attach to
 * events. If no Sentry SDK is loaded the wrappers degrade to structured
 * pino logging and these helpers still return useful shapes.
 */

import { envFlag, optionalEnv } from './env.js';

/**
 * Names of every env var we consider when deciding whether pilot mode is
 * on. The first one set wins.
 */
export const PILOT_MODE_ENV_NAMES = [
  'BORJIE_PILOT_MODE',
  'NEXT_PUBLIC_BORJIE_PILOT_MODE',
  'EXPO_PUBLIC_BORJIE_PILOT_MODE',
] as const;

export type PilotModeEnvName = (typeof PILOT_MODE_ENV_NAMES)[number];

/**
 * Optional caller-supplied env source. Tests pass a plain record so they
 * don't pollute `process.env`. In production callers omit this and we
 * fall back to `process.env` via the platform helpers.
 */
export type PilotEnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Returns true when ANY of the pilot-mode env vars is truthy
 * (`1`, `true`, `yes`, case-insensitive).
 *
 * - `BORJIE_PILOT_MODE` is the canonical server-side flag.
 * - `NEXT_PUBLIC_BORJIE_PILOT_MODE` is the web flag injected by Next.
 * - `EXPO_PUBLIC_BORJIE_PILOT_MODE` is the mobile flag injected by Expo.
 *
 * Callers can pass a `source` map to avoid touching `process.env` —
 * particularly important for unit tests and for environments where
 * Sentry runs inside a worker with a frozen env snapshot.
 */
export function isPilotMode(source?: PilotEnvSource): boolean {
  if (source) {
    for (const name of PILOT_MODE_ENV_NAMES) {
      const value = source[name];
      if (typeof value !== 'string') continue;
      const normalized = value.trim().toLowerCase();
      if (
        normalized === '1' ||
        normalized === 'true' ||
        normalized === 'yes'
      ) {
        return true;
      }
    }
    return false;
  }
  for (const name of PILOT_MODE_ENV_NAMES) {
    if (envFlag(name)) return true;
  }
  return false;
}

/**
 * Sentry-shaped tag bundle attached to every event when pilot mode is on.
 *
 * The names mirror the Sentry SDK convention (`tags.*`, `extra.*`) so a
 * downstream wrapper can spread the result straight into a Sentry scope.
 */
export interface PilotEventContext {
  readonly tags: Readonly<{
    /** Stable per-pilot identifier (NOT raw user ID — derived/hashed). */
    pilot_user_id?: string;
    /** Cohort tag — "ferengi-alpha", "tanzanite-beta", etc. */
    pilot_cohort?: string;
    /** Always true in pilot mode so dashboards can filter. */
    pilot_mode: 'true';
  }>;
  readonly extra: Readonly<{
    /** Session-replay correlation ID when one is available. */
    replay_session_id?: string;
  }>;
  /** Sentry sample rate the wrapper should use for *this* request. */
  readonly tracesSampleRate: number;
}

/**
 * Caller-supplied per-event metadata. Only fields that resolve to a
 * non-empty trimmed string are surfaced — callers can pass `undefined`
 * without polluting the resulting tags.
 */
export interface PilotEventInput {
  readonly pilotUserId?: string | null;
  readonly pilotCohort?: string | null;
  readonly replaySessionId?: string | null;
}

const DEFAULT_PILOT_SAMPLE_RATE = 1.0;
const DEFAULT_BASELINE_SAMPLE_RATE = 0.1;

function cleanTagValue(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Build the Sentry context bundle for a single error event.
 *
 * Returns a frozen object so callers cannot mutate the bundle in place.
 * When pilot mode is OFF the function still returns a valid bundle —
 * empty tags + the baseline sample rate — so wrappers can call it
 * unconditionally.
 */
export function buildPilotEventContext(
  input: PilotEventInput = {},
  options: {
    readonly source?: PilotEnvSource;
    readonly baselineSampleRate?: number;
    readonly pilotSampleRate?: number;
  } = {},
): PilotEventContext {
  const enabled = isPilotMode(options.source);
  const baseline = clampSampleRate(
    options.baselineSampleRate ?? DEFAULT_BASELINE_SAMPLE_RATE,
  );
  const pilot = clampSampleRate(
    options.pilotSampleRate ?? DEFAULT_PILOT_SAMPLE_RATE,
  );

  if (!enabled) {
    return Object.freeze({
      tags: Object.freeze({} as PilotEventContext['tags']),
      extra: Object.freeze({} as PilotEventContext['extra']),
      tracesSampleRate: baseline,
    });
  }

  const pilotUserId = cleanTagValue(input.pilotUserId);
  const pilotCohort = cleanTagValue(input.pilotCohort);
  const replaySessionId = cleanTagValue(input.replaySessionId);

  const tags: Record<string, string> = { pilot_mode: 'true' };
  if (pilotUserId) tags.pilot_user_id = pilotUserId;
  if (pilotCohort) tags.pilot_cohort = pilotCohort;

  const extra: Record<string, string> = {};
  if (replaySessionId) extra.replay_session_id = replaySessionId;

  return Object.freeze({
    tags: Object.freeze(tags) as PilotEventContext['tags'],
    extra: Object.freeze(extra) as PilotEventContext['extra'],
    tracesSampleRate: pilot,
  });
}

function clampSampleRate(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BASELINE_SAMPLE_RATE;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Pilot cohort + per-user identity. Stored in module memory by the
 * Sentry wrappers via `setPilotUser`; surfaced here so non-Sentry
 * surfaces (the BFF audit log, pilot-error dashboard) can reuse the
 * same shape.
 */
export interface PilotUser {
  readonly id: string;
  readonly cohort: string;
}

/**
 * Resolve the active sample rate without building the full context.
 * Useful for tracesSampler callbacks that need to make a decision per
 * request without re-walking the env every time.
 */
export function resolvePilotSampleRate(options: {
  readonly source?: PilotEnvSource;
  readonly baselineSampleRate?: number;
  readonly pilotSampleRate?: number;
} = {}): number {
  const enabled = isPilotMode(options.source);
  if (enabled) {
    return clampSampleRate(
      options.pilotSampleRate ?? DEFAULT_PILOT_SAMPLE_RATE,
    );
  }
  return clampSampleRate(
    options.baselineSampleRate ?? DEFAULT_BASELINE_SAMPLE_RATE,
  );
}

/**
 * Cleanly read the pilot cohort env (no truthy parsing — we want the raw
 * string). Returns `undefined` when unset. Used by wrappers to seed the
 * default cohort tag on every event before the user logs in.
 */
export function readDefaultPilotCohort(
  source?: PilotEnvSource,
): string | undefined {
  if (source) {
    const value = source.BORJIE_PILOT_COHORT;
    return cleanTagValue(value);
  }
  return cleanTagValue(optionalEnv('BORJIE_PILOT_COHORT'));
}
