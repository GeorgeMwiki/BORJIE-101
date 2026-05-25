/**
 * Drift-detector tests — Wave 28.
 */

import { describe, it, expect } from 'vitest';
import { createPersonaDriftDetector } from '../drift-detector.js';

function sample(
  tenantId: string,
  personaId: string,
  score: number,
  timestamp = 0,
) {
  return { tenantId, personaId, score, timestamp };
}

describe('voice-persona-dna — createPersonaDriftDetector', () => {
  it('does not alert until the buffer is at least half-full', () => {
    const detector = createPersonaDriftDetector({ windowSize: 10, threshold: 0.8 });
    // Push 2 low-scoring samples — still below half-buffer minimum.
    const first = detector.record(sample('t1', 'mr-mwikila-tenant', 0.1));
    const second = detector.record(sample('t1', 'mr-mwikila-tenant', 0.1));
    expect(first).toBeNull();
    expect(second).toBeNull();
  });

  it('emits an alert when the rolling mean drops below threshold', () => {
    let now = 1_000;
    const detector = createPersonaDriftDetector({
      windowSize: 6,
      threshold: 0.65,
      now: () => now,
    });
    // Six low samples — mean 0.1 << threshold.
    let alert = null;
    for (let i = 0; i < 6; i += 1) {
      now += 1;
      alert = detector.record(sample('t1', 'mr-mwikila-tenant', 0.1, now));
    }
    expect(alert).not.toBeNull();
    expect(alert?.tenantId).toBe('t1');
    expect(alert?.personaId).toBe('mr-mwikila-tenant');
    expect(alert?.averageScore).toBeLessThan(0.65);
  });

  it('does not alert while the rolling mean stays above threshold', () => {
    const detector = createPersonaDriftDetector({
      windowSize: 6,
      threshold: 0.65,
    });
    let last = null;
    for (let i = 0; i < 6; i += 1) {
      last = detector.record(sample('t1', 'mr-mwikila-tenant', 0.9));
    }
    expect(last).toBeNull();
  });

  it('enforces a cooldown between consecutive alerts', () => {
    let now = 1_000;
    const detector = createPersonaDriftDetector({
      windowSize: 4,
      threshold: 0.65,
      now: () => now,
    });
    // Fill buffer with four low samples to trigger first alert.
    let alert = null;
    for (let i = 0; i < 4; i += 1) {
      now += 1;
      alert = detector.record(sample('t1', 'mr-mwikila-tenant', 0.1, now));
    }
    expect(alert).not.toBeNull();

    // One more low sample immediately — should be suppressed by cooldown.
    now += 10;
    const suppressed = detector.record(
      sample('t1', 'mr-mwikila-tenant', 0.1, now),
    );
    expect(suppressed).toBeNull();
  });

  it('getRecent returns immutable snapshots', () => {
    const detector = createPersonaDriftDetector({ windowSize: 5 });
    detector.record(sample('t2', 'mr-mwikila-head', 0.8));
    detector.record(sample('t2', 'mr-mwikila-head', 0.9));
    const snap = detector.getRecent('t2', 'mr-mwikila-head');
    expect(snap.length).toBe(2);
    // mutating the snap array must not affect the detector's internal buffer
    (snap as unknown as Array<unknown>).push({});
    expect(detector.getRecent('t2', 'mr-mwikila-head').length).toBe(2);
  });

  it('clear() wipes a single tenant without touching others', () => {
    const detector = createPersonaDriftDetector({ windowSize: 5 });
    detector.record(sample('tA', 'mr-mwikila-tenant', 0.9));
    detector.record(sample('tB', 'mr-mwikila-tenant', 0.9));
    detector.clear('tA');
    expect(detector.getRecent('tA', 'mr-mwikila-tenant').length).toBe(0);
    expect(detector.getRecent('tB', 'mr-mwikila-tenant').length).toBe(1);
  });

  it('rejects invalid window size / threshold configuration', () => {
    expect(() =>
      createPersonaDriftDetector({ windowSize: 2, threshold: 0.5 }),
    ).toThrow();
    expect(() =>
      createPersonaDriftDetector({ windowSize: 5, threshold: 0 }),
    ).toThrow();
    expect(() =>
      createPersonaDriftDetector({ windowSize: 5, threshold: 1 }),
    ).toThrow();
  });
});
