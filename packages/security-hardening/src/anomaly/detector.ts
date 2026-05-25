/**
 * Login anomaly detector.
 *
 * Composes three independent detectors and aggregates them into a
 * single `AnomalyScore` in [0, 1] with a `recommendation`. The
 * recommendation is consumed by the step-up MFA orchestrator — when
 * the score crosses `stepUpThreshold` we ask for a fresh MFA challenge;
 * when it crosses `blockThreshold` we refuse the login outright.
 *
 * Detectors (each contributes ≤ 1.0 to the raw score; we cap at 1.0):
 *
 *   1. Impossible travel — haversine between this login's location and
 *      the most recent login's location, divided by elapsed time. Speeds
 *      above `maxPlausibleKmPerHour` (default 900 km/h ≈ commercial jet)
 *      add 1.0 to the score.
 *
 *   2. Unusual hours — when the user's `tz` is known, score how far
 *      this login's local-hour is from their typical pattern (the last
 *      `historyN` logins). No-history users get 0 (no signal).
 *
 *   3. Device drift — the device fingerprint (FingerprintJS-style hash)
 *      hasn't been seen for this user before.
 *
 * Each detector explains itself via a `factor` string for audit logs.
 */

import type {
  AnomalyRecommendation,
  AnomalyScore,
  GeoLocation,
  LoginAttempt,
} from '../types.js';
import { impliedKmPerHour } from './geo.js';

export interface AnomalyDetectorOptions {
  readonly maxPlausibleKmPerHour?: number; // default 900
  readonly stepUpThreshold?: number; // default 0.4
  readonly blockThreshold?: number; // default 0.85
  /** How many recent logins to inspect for unusual-hours detection. */
  readonly historyN?: number; // default 10
  /** When a login's local hour is in this set, mark unusual. */
  readonly unusualLocalHours?: ReadonlySet<number>; // default {0,1,2,3,4}
}

export interface ScoreLoginInput {
  readonly attempt: LoginAttempt;
  readonly history: ReadonlyArray<LoginAttempt>;
}

const DEFAULT_UNUSUAL_HOURS: ReadonlySet<number> = new Set([0, 1, 2, 3, 4]);

export interface AnomalyDetector {
  scoreLogin(input: ScoreLoginInput): AnomalyScore;
}

export function createAnomalyDetector(
  opts: AnomalyDetectorOptions = {},
): AnomalyDetector {
  const maxKmh = opts.maxPlausibleKmPerHour ?? 900;
  const stepUp = opts.stepUpThreshold ?? 0.4;
  const block = opts.blockThreshold ?? 0.85;
  const historyN = opts.historyN ?? 10;
  const unusual = opts.unusualLocalHours ?? DEFAULT_UNUSUAL_HOURS;

  return {
    scoreLogin({ attempt, history }) {
      const factors: string[] = [];
      let raw = 0;

      // ----- 1. Impossible travel ---------------------------------
      const lastAttempt = mostRecentByTime(history, attempt.at);
      if (lastAttempt) {
        const kmh = impliedKmPerHour(
          lastAttempt.at,
          lastAttempt.location,
          attempt.at,
          attempt.location,
        );
        if (kmh > maxKmh) {
          raw += 1.0;
          factors.push(`impossible_travel:${Math.round(kmh)}kmh`);
        } else if (kmh > maxKmh * 0.5) {
          raw += 0.3;
          factors.push(`fast_travel:${Math.round(kmh)}kmh`);
        }
        if (!sameCountry(lastAttempt.location, attempt.location)) {
          raw += 0.1;
          factors.push(`country_change`);
        }
      }

      // ----- 2. Unusual hours -------------------------------------
      if (attempt.location.timezone) {
        const hour = localHourInTz(attempt.at, attempt.location.timezone);
        if (unusual.has(hour)) {
          raw += 0.2;
          factors.push(`unusual_hour:${hour}`);
        }
        // Compare against the user's recent pattern
        const recent = history.slice(-historyN);
        const seenHours = new Set(
          recent
            .map((h) =>
              h.location.timezone
                ? localHourInTz(h.at, h.location.timezone)
                : -1,
            )
            .filter((h) => h >= 0),
        );
        if (seenHours.size > 0 && !seenHours.has(hour)) {
          raw += 0.15;
          factors.push(`hour_outside_pattern`);
        }
      }

      // ----- 3. Device drift --------------------------------------
      const seenDevices = new Set(history.map((h) => h.deviceFingerprint));
      if (seenDevices.size > 0 && !seenDevices.has(attempt.deviceFingerprint)) {
        raw += 0.3;
        factors.push(`new_device`);
      }

      const score = Math.min(1, Math.max(0, raw));
      const recommendation: AnomalyRecommendation =
        score >= block ? 'block' : score >= stepUp ? 'step_up' : 'allow';
      return { score, factors, recommendation };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function mostRecentByTime(
  history: ReadonlyArray<LoginAttempt>,
  beforeAt: number,
): LoginAttempt | null {
  let best: LoginAttempt | null = null;
  for (const h of history) {
    if (h.at >= beforeAt) continue;
    if (!best || h.at > best.at) best = h;
  }
  return best;
}

function sameCountry(a: GeoLocation, b: GeoLocation): boolean {
  if (!a.country || !b.country) return true;
  return a.country === b.country;
}

/**
 * Compute the local hour [0..23] in the given IANA timezone for the
 * given UTC epoch ms. Uses Intl.DateTimeFormat to avoid pulling a
 * tz database into the package.
 */
function localHourInTz(atMs: number, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
    }).formatToParts(new Date(atMs));
    const h = parts.find((p) => p.type === 'hour')?.value;
    if (!h) return 0;
    const parsed = parseInt(h, 10);
    if (Number.isNaN(parsed)) return 0;
    // `Intl` may return "24" at midnight in some locales — normalise.
    return parsed % 24;
  } catch {
    return 0;
  }
}
