import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GEO_CONFIG,
  DEFAULT_VELOCITY_CONFIG,
  geoAnomaly,
  haversineKm,
  velocityScore,
  type ActivityEvent,
} from '../anti-fraud-heuristics.js';

const ev = (overrides: Partial<ActivityEvent> & Pick<ActivityEvent, 'tsMs' | 'kind' | 'subjectId'>): ActivityEvent => ({
  ...overrides,
});

describe('anti-fraud: velocity', () => {
  it('normal when below elevated threshold', () => {
    const out = velocityScore([], 's1', 'login', 1000);
    expect(out.verdict).toBe('normal');
    expect(out.count).toBe(0);
  });

  it('elevated when reaching elevated threshold', () => {
    const events: ActivityEvent[] = [];
    for (let i = 0; i < 5; i++) events.push(ev({ tsMs: 100 + i, subjectId: 's1', kind: 'login' }));
    const out = velocityScore(events, 's1', 'login', 1000);
    expect(out.verdict).toBe('elevated');
  });

  it('high when at high threshold', () => {
    const events: ActivityEvent[] = [];
    for (let i = 0; i < 20; i++) events.push(ev({ tsMs: 100 + i, subjectId: 's1', kind: 'login' }));
    const out = velocityScore(events, 's1', 'login', 1000);
    expect(out.verdict).toBe('high');
  });

  it('ignores events outside window', () => {
    const events: ActivityEvent[] = [];
    for (let i = 0; i < 30; i++) events.push(ev({ tsMs: 100, subjectId: 's1', kind: 'login' }));
    const out = velocityScore(events, 's1', 'login', 999_999, DEFAULT_VELOCITY_CONFIG);
    expect(out.count).toBe(0);
    expect(out.verdict).toBe('normal');
  });

  it('ignores other subjects', () => {
    const events: ActivityEvent[] = [];
    for (let i = 0; i < 30; i++) events.push(ev({ tsMs: 100 + i, subjectId: 'other', kind: 'login' }));
    const out = velocityScore(events, 's1', 'login', 1000);
    expect(out.count).toBe(0);
  });

  it('ignores other kinds', () => {
    const events: ActivityEvent[] = [];
    for (let i = 0; i < 30; i++) events.push(ev({ tsMs: 100 + i, subjectId: 's1', kind: 'payment' }));
    const out = velocityScore(events, 's1', 'login', 1000);
    expect(out.count).toBe(0);
  });

  it('score is clamped at 1', () => {
    const events: ActivityEvent[] = [];
    for (let i = 0; i < 999; i++) events.push(ev({ tsMs: 100 + i, subjectId: 's1', kind: 'login' }));
    const out = velocityScore(events, 's1', 'login', 1100);
    expect(out.score).toBeLessThanOrEqual(1);
  });
});

describe('anti-fraud: haversine + geo-anomaly', () => {
  it('haversine of same point is 0', () => {
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })).toBe(0);
  });

  it('haversine for Nairobi -> Dar es Salaam ≈ 680km', () => {
    const nbo = { lat: -1.2921, lon: 36.8219 };
    const dar = { lat: -6.7924, lon: 39.2083 };
    const km = haversineKm(nbo, dar);
    expect(km).toBeGreaterThan(600);
    expect(km).toBeLessThan(800);
  });

  it('geoAnomaly returns null when coords missing', () => {
    const prev: ActivityEvent = { tsMs: 0, subjectId: 's1', kind: 'login' };
    const next: ActivityEvent = { tsMs: 1, subjectId: 's1', kind: 'login', lat: 0, lon: 0 };
    expect(geoAnomaly(prev, next)).toBeNull();
  });

  it('geoAnomaly flags impossible travel', () => {
    const prev: ActivityEvent = { tsMs: 0, subjectId: 's1', kind: 'login', lat: 0, lon: 0 };
    const next: ActivityEvent = { tsMs: 1000, subjectId: 's1', kind: 'login', lat: 30, lon: 30 };
    const out = geoAnomaly(prev, next);
    expect(out).not.toBeNull();
    expect(out?.verdict).toBe('impossible');
  });

  it('geoAnomaly returns normal for slow movement', () => {
    const prev: ActivityEvent = { tsMs: 0, subjectId: 's1', kind: 'login', lat: 0, lon: 0 };
    const next: ActivityEvent = {
      tsMs: 3_600_000 * 2,
      subjectId: 's1',
      kind: 'login',
      lat: 0,
      lon: 1, // ~111 km at equator, over 2h = ~55 km/h
    };
    const out = geoAnomaly(prev, next);
    expect(out?.verdict).toBe('normal');
  });

  it('geoAnomaly handles zero elapsed gracefully (no NaN)', () => {
    const prev: ActivityEvent = { tsMs: 100, subjectId: 's1', kind: 'login', lat: 0, lon: 0 };
    const next: ActivityEvent = { tsMs: 100, subjectId: 's1', kind: 'login', lat: 1, lon: 1 };
    const out = geoAnomaly(prev, next);
    expect(out).not.toBeNull();
    expect(Number.isFinite(out?.impliedKmPerHour ?? 0)).toBe(true);
  });

  it('uses configured thresholds', () => {
    const prev: ActivityEvent = { tsMs: 0, subjectId: 's1', kind: 'login', lat: 0, lon: 0 };
    const next: ActivityEvent = {
      tsMs: 3_600_000,
      subjectId: 's1',
      kind: 'login',
      lat: 0,
      lon: 1,
    };
    const out = geoAnomaly(prev, next, {
      ...DEFAULT_GEO_CONFIG,
      suspiciousKmPerHour: 50,
      impossibleKmPerHour: 200,
    });
    expect(out?.verdict).toBe('suspicious');
  });
});
