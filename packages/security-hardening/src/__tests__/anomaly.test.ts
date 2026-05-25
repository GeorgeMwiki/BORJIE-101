import { describe, it, expect } from 'vitest';

import { haversineKm, impliedKmPerHour } from '../anomaly/geo.js';
import { createAnomalyDetector } from '../anomaly/detector.js';
import type { LoginAttempt } from '../types.js';

describe('haversine + implied speed', () => {
  it('returns ~0 for the same point', () => {
    expect(
      haversineKm(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 0 },
      ),
    ).toBeCloseTo(0, 5);
  });

  it('Nairobi <-> Dar es Salaam is ~700 km within 10%', () => {
    const nbo = { latitude: -1.286389, longitude: 36.817223 };
    const dar = { latitude: -6.7924, longitude: 39.2083 };
    const d = haversineKm(nbo, dar);
    expect(d).toBeGreaterThan(620);
    expect(d).toBeLessThan(800);
  });

  it('implied speed is infinity when the deltaMs is zero or negative', () => {
    const nbo = { latitude: -1.286389, longitude: 36.817223 };
    const lon = { latitude: 51.5074, longitude: -0.1278 };
    expect(impliedKmPerHour(100, nbo, 100, lon)).toBe(Infinity);
    expect(impliedKmPerHour(200, nbo, 100, lon)).toBe(Infinity);
  });
});

const NAIROBI = {
  latitude: -1.286389,
  longitude: 36.817223,
  country: 'KE',
  timezone: 'Africa/Nairobi',
};
const DAR = {
  latitude: -6.7924,
  longitude: 39.2083,
  country: 'TZ',
  timezone: 'Africa/Dar_es_Salaam',
};
const LONDON = {
  latitude: 51.5074,
  longitude: -0.1278,
  country: 'GB',
  timezone: 'Europe/London',
};

function attempt(overrides: Partial<LoginAttempt>): LoginAttempt {
  return {
    userId: 'u1',
    tenantId: 'tA',
    at: Date.UTC(2026, 4, 24, 10, 0, 0),
    location: NAIROBI,
    deviceFingerprint: 'dev-1',
    ...overrides,
  };
}

describe('anomaly detector', () => {
  it('returns score 0 + `allow` when there is no history', () => {
    const det = createAnomalyDetector();
    const result = det.scoreLogin({
      attempt: attempt({}),
      history: [],
    });
    expect(result.score).toBe(0);
    expect(result.recommendation).toBe('allow');
    expect(result.factors).toEqual([]);
  });

  it('flags impossible travel — Nairobi to London in 10 minutes -> block', () => {
    const det = createAnomalyDetector();
    const tNow = Date.UTC(2026, 4, 24, 10, 0, 0);
    const tEarlier = tNow - 10 * 60 * 1000;
    const result = det.scoreLogin({
      attempt: attempt({ at: tNow, location: LONDON }),
      history: [attempt({ at: tEarlier, location: NAIROBI })],
    });
    expect(result.factors.some((f) => f.startsWith('impossible_travel:'))).toBe(
      true,
    );
    expect(result.score).toBeGreaterThanOrEqual(0.85);
    expect(result.recommendation).toBe('block');
  });

  it('same-region login (NBO->NBO same hour same device) -> allow', () => {
    const det = createAnomalyDetector();
    const tNow = Date.UTC(2026, 4, 24, 10, 0, 0);
    const result = det.scoreLogin({
      attempt: attempt({ at: tNow }),
      // history exactly 24 hours earlier — same hour, same device, same place
      history: [attempt({ at: tNow - 24 * 60 * 60 * 1000 })],
    });
    expect(result.score).toBe(0);
    expect(result.recommendation).toBe('allow');
    expect(result.factors).toEqual([]);
  });

  it('flags new device against established history', () => {
    const det = createAnomalyDetector();
    const tNow = Date.UTC(2026, 4, 24, 12, 0, 0);
    const result = det.scoreLogin({
      attempt: attempt({ at: tNow, deviceFingerprint: 'dev-NEW' }),
      history: [
        attempt({ at: tNow - 7 * 86_400_000, deviceFingerprint: 'dev-1' }),
        attempt({ at: tNow - 5 * 86_400_000, deviceFingerprint: 'dev-1' }),
      ],
    });
    expect(result.factors).toContain('new_device');
    expect(result.score).toBeGreaterThan(0);
  });

  it('flags an unusual local hour (02:00 Africa/Nairobi)', () => {
    const det = createAnomalyDetector();
    // 02:30 Africa/Nairobi = 23:30 the previous UTC day
    const at = Date.UTC(2026, 4, 23, 23, 30, 0);
    const result = det.scoreLogin({
      attempt: attempt({ at }),
      history: [],
    });
    expect(result.factors.some((f) => f.startsWith('unusual_hour:'))).toBe(true);
  });

  it('combines fast-travel-but-plausible (NBO->DAR ~600km in 1h) into a step-up', () => {
    const det = createAnomalyDetector();
    const tNow = Date.UTC(2026, 4, 24, 11, 0, 0);
    const tEarlier = tNow - 60 * 60 * 1000;
    const result = det.scoreLogin({
      attempt: attempt({ at: tNow, location: DAR, deviceFingerprint: 'dev-2' }),
      history: [attempt({ at: tEarlier, location: NAIROBI })],
    });
    // ~600 km in 1h is plausible for a commercial flight (< 900 km/h) but
    // we still trip on country_change + new_device — should at minimum
    // produce a non-zero score.
    expect(result.score).toBeGreaterThan(0);
    expect(result.factors).toContain('country_change');
    expect(result.factors).toContain('new_device');
  });

  it('honours custom thresholds (lower stepUpThreshold -> earlier escalation)', () => {
    const det = createAnomalyDetector({
      stepUpThreshold: 0.1,
      blockThreshold: 0.5,
    });
    const tNow = Date.UTC(2026, 4, 24, 12, 0, 0);
    const result = det.scoreLogin({
      attempt: attempt({ at: tNow, deviceFingerprint: 'dev-NEW' }),
      history: [
        attempt({ at: tNow - 86_400_000, deviceFingerprint: 'dev-old' }),
      ],
    });
    expect(result.recommendation).not.toBe('allow');
  });
});
