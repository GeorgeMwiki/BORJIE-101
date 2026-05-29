/**
 * Tests for the on-device-router stub (Roadmap R4).
 *
 * The stub is a no-op — we lock the contract so consumers can rely on
 * the shape today and switch to the ONNX implementation later without
 * touching call sites.
 */

import { describe, it, expect } from 'vitest';
import {
  routeOnDevice,
  ON_DEVICE_ROUTER_STATUS,
} from '../src/index';

describe('routeOnDevice (stub)', () => {
  it('returns a no-op decision by default', () => {
    const decision = routeOnDevice('show me cash flow');
    expect(decision.toolId).toBeNull();
    expect(decision.confidence).toBe(0);
    expect(decision.inferMs).toBe(0);
    expect(decision.modelId).toBe('stub');
  });

  it('echoes a configured modelId', () => {
    const decision = routeOnDevice('hi', { modelId: 'MiniLM-L6-v2-q8' });
    expect(decision.modelId).toBe('MiniLM-L6-v2-q8');
  });

  it('honours a fixedDecision override (test seam)', () => {
    const fixedDecision = {
      toolId: 'mining.cockpit.daily-brief',
      confidence: 0.88,
      inferMs: 12,
      modelId: 'MiniLM-L6-v2-q8',
    } as const;
    expect(routeOnDevice('brief me', { fixedDecision })).toEqual(fixedDecision);
  });

  it('returns frozen decisions (immutability hard rule)', () => {
    const decision = routeOnDevice('x');
    expect(Object.isFrozen(decision)).toBe(true);
  });
});

describe('ON_DEVICE_ROUTER_STATUS', () => {
  it('ships bilingual sentinel', () => {
    expect(ON_DEVICE_ROUTER_STATUS.en).toMatch(/STUB/);
    expect(ON_DEVICE_ROUTER_STATUS.sw).toMatch(/STUB/);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ON_DEVICE_ROUTER_STATUS)).toBe(true);
  });
});
