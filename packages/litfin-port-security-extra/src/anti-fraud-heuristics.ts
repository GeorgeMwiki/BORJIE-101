/**
 * Anti-fraud heuristics — velocity checks + geo-anomaly.
 *
 * LITFIN ref: src/core/security/* + src/core/risk-assessment/* —
 * stateless scorers that the wiring layer feeds with a sliding event
 * window from the auth/payment store.
 *
 * These are advisory: a high score should trigger MFA-step-up or
 * manual review, not an outright block (which is the job of policy).
 */

export interface ActivityEvent {
  readonly tsMs: number;
  readonly subjectId: string;
  readonly kind: 'login' | 'payment' | 'password-reset' | 'export' | 'api-call';
  readonly amount?: number;
  readonly currencyCode?: string;
  readonly lat?: number;
  readonly lon?: number;
  readonly ipAsn?: number;
  readonly userAgent?: string;
}

export interface VelocityScore {
  readonly subjectId: string;
  readonly windowMs: number;
  readonly count: number;
  readonly score: number; // 0..1
  readonly verdict: 'normal' | 'elevated' | 'high';
}

export interface VelocityConfig {
  readonly windowMs: number;
  readonly elevatedAt: number;
  readonly highAt: number;
}

export const DEFAULT_VELOCITY_CONFIG: VelocityConfig = {
  windowMs: 60_000,
  elevatedAt: 5,
  highAt: 20,
};

export const velocityScore = (
  events: readonly ActivityEvent[],
  subjectId: string,
  kind: ActivityEvent['kind'],
  nowMs: number,
  cfg: VelocityConfig = DEFAULT_VELOCITY_CONFIG,
): VelocityScore => {
  const since = nowMs - cfg.windowMs;
  const count = events.filter(
    (e) => e.subjectId === subjectId && e.kind === kind && e.tsMs >= since && e.tsMs <= nowMs,
  ).length;
  const score = Math.min(1, count / cfg.highAt);
  let verdict: VelocityScore['verdict'] = 'normal';
  if (count >= cfg.highAt) verdict = 'high';
  else if (count >= cfg.elevatedAt) verdict = 'elevated';
  return { subjectId, windowMs: cfg.windowMs, count, score, verdict };
};

// ----------------------------------------------------------------------
// Geo-anomaly — "impossible travel" detector.
// ----------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

export const haversineKm = (
  a: { readonly lat: number; readonly lon: number },
  b: { readonly lat: number; readonly lon: number },
): number => {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

export interface GeoAnomalyConfig {
  /** Above this km/h we flag as impossible. Default ~commercial flight cruise. */
  readonly impossibleKmPerHour: number;
  /** Above this km/h we flag as suspicious. */
  readonly suspiciousKmPerHour: number;
}

export const DEFAULT_GEO_CONFIG: GeoAnomalyConfig = {
  impossibleKmPerHour: 1000,
  suspiciousKmPerHour: 400,
};

export interface GeoAnomalyResult {
  readonly distanceKm: number;
  readonly elapsedHours: number;
  readonly impliedKmPerHour: number;
  readonly verdict: 'normal' | 'suspicious' | 'impossible';
}

export const geoAnomaly = (
  prev: ActivityEvent,
  next: ActivityEvent,
  cfg: GeoAnomalyConfig = DEFAULT_GEO_CONFIG,
): GeoAnomalyResult | null => {
  if (
    prev.lat === undefined ||
    prev.lon === undefined ||
    next.lat === undefined ||
    next.lon === undefined
  ) {
    return null;
  }
  const distanceKm = haversineKm(
    { lat: prev.lat, lon: prev.lon },
    { lat: next.lat, lon: next.lon },
  );
  const elapsedHours = Math.max(1 / 3600, (next.tsMs - prev.tsMs) / 3_600_000);
  const impliedKmPerHour = distanceKm / elapsedHours;
  let verdict: GeoAnomalyResult['verdict'] = 'normal';
  if (impliedKmPerHour >= cfg.impossibleKmPerHour) verdict = 'impossible';
  else if (impliedKmPerHour >= cfg.suspiciousKmPerHour) verdict = 'suspicious';
  return { distanceKm, elapsedHours, impliedKmPerHour, verdict };
};
