/**
 * Canary controller tests — ladder semantics + sticky routing.
 */

import { describe, it, expect } from 'vitest';
import {
  STAGE_TRAFFIC_SHARE,
  demoteStage,
  promoteStage,
  shouldRouteToCanary,
  stageIndex,
} from '../slo/canary-controller.js';

describe('STAGE_TRAFFIC_SHARE', () => {
  it('is strictly monotonic shadow → live', () => {
    expect(STAGE_TRAFFIC_SHARE.shadow).toBe(0);
    expect(STAGE_TRAFFIC_SHARE['canary-1pct']).toBe(0.01);
    expect(STAGE_TRAFFIC_SHARE['canary-5pct']).toBe(0.05);
    expect(STAGE_TRAFFIC_SHARE['canary-25pct']).toBe(0.25);
    expect(STAGE_TRAFFIC_SHARE.live).toBe(1);
  });
});

describe('stageIndex', () => {
  it('returns 0 for shadow, 4 for live', () => {
    expect(stageIndex('shadow')).toBe(0);
    expect(stageIndex('live')).toBe(4);
  });
});

describe('demoteStage', () => {
  it('drops one rung', () => {
    expect(demoteStage('live')).toBe('canary-25pct');
    expect(demoteStage('canary-25pct')).toBe('canary-5pct');
    expect(demoteStage('canary-5pct')).toBe('canary-1pct');
    expect(demoteStage('canary-1pct')).toBe('shadow');
  });

  it('returns null at shadow (floor)', () => {
    expect(demoteStage('shadow')).toBeNull();
  });
});

describe('promoteStage', () => {
  it('climbs one rung', () => {
    expect(promoteStage('shadow')).toBe('canary-1pct');
    expect(promoteStage('canary-25pct')).toBe('live');
  });

  it('returns null at live (ceiling)', () => {
    expect(promoteStage('live')).toBeNull();
  });
});

describe('shouldRouteToCanary', () => {
  it('is false for shadow regardless of input', () => {
    expect(shouldRouteToCanary('shadow', 'req-1')).toBe(false);
    expect(shouldRouteToCanary('shadow', 'req-2')).toBe(false);
  });

  it('is true for live regardless of input', () => {
    expect(shouldRouteToCanary('live', 'req-1')).toBe(true);
  });

  it('is sticky — same requestId always lands the same side', () => {
    const id = 'sticky-request-7777';
    const a = shouldRouteToCanary('canary-5pct', id);
    const b = shouldRouteToCanary('canary-5pct', id);
    const c = shouldRouteToCanary('canary-5pct', id);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('routes approximately the configured fraction over many ids', () => {
    let canary = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) {
      if (shouldRouteToCanary('canary-25pct', `req-${i}`)) canary++;
    }
    const share = canary / n;
    // Should be near 0.25; allow ±0.05 for the modest sample.
    expect(share).toBeGreaterThan(0.20);
    expect(share).toBeLessThan(0.30);
  });

  it('canary-1pct sends nearly no traffic', () => {
    let canary = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      if (shouldRouteToCanary('canary-1pct', `req-${i}`)) canary++;
    }
    const share = canary / n;
    expect(share).toBeLessThan(0.03);
  });
});
