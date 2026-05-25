/**
 * Per-jurisdiction DSAR response SLA table.
 *
 * Computed in hours; the SLA is the LEGAL window, not a target — most
 * implementations aim for half of it.
 *
 * Sources:
 *   - GDPR Art.12(3) — 1 month (extensible by 2 more) ≈ 720h
 *   - CCPA §1798.130 — 45 days (extensible by 45 more) = 1080h
 *   - POPIA §23(2) — "reasonable time" — codified here as 30 days
 *   - TZ-DPA, KE-DPA, UG-DPA, NG-NDPR — 30 days (regional convergence)
 *   - RW-DPA — 30 days
 */

import type { DSARKind, Jurisdiction } from '../types.js';

const HOURS_PER_DAY = 24;

/**
 * Hours within which the controller must complete the DSAR or send a
 * statutory holding notice. Computed conservatively (smaller window).
 */
export const DSAR_SLA_HOURS: Readonly<Record<Jurisdiction, number>> = {
  GLOBAL: 30 * HOURS_PER_DAY,
  EU: 30 * HOURS_PER_DAY, // 1 month, treated as 30 days
  UK: 30 * HOURS_PER_DAY,
  'US-CA': 45 * HOURS_PER_DAY,
  ZA: 30 * HOURS_PER_DAY,
  TZ: 30 * HOURS_PER_DAY,
  KE: 30 * HOURS_PER_DAY,
  UG: 30 * HOURS_PER_DAY,
  RW: 30 * HOURS_PER_DAY,
  NG: 30 * HOURS_PER_DAY,
};

/**
 * Compute the SLA deadline for a request.
 *
 * `kind` is accepted because some jurisdictions treat erasure or
 * portability differently; today they all share the SLA, but the API
 * leaves room to vary per-kind without a refactor.
 */
export function computeDSARDeadline(
  receivedAt: Date,
  jurisdiction: Jurisdiction,
  _kind: DSARKind,
): Date {
  const hours = DSAR_SLA_HOURS[jurisdiction] ?? DSAR_SLA_HOURS.GLOBAL;
  return new Date(receivedAt.getTime() + hours * 60 * 60 * 1000);
}
