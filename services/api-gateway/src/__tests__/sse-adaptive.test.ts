/**
 * Tests for the adaptive-stream controller (Roadmap R10).
 *
 * Drives the controller through a producer that emits a known word
 * sequence, an ACK loop that mimics a slow vs fast client, and locks
 * the mode-transition invariants:
 *
 *   - micro → batch when lag ≥ lagBatchThreshold
 *   - batch → micro when lag < lagMicroThreshold
 *   - batched chunk concatenates pending words
 */

import { describe, it, expect } from 'vitest';
import { createAdaptiveStreamController } from '../services/brain/sse-adaptive';

const WORDS = [
  'Cash',
  'flow',
  'this',
  'week',
  'is',
  'positive',
  'at',
  'Geita',
  'Pit',
  '2',
  '.',
  'Production',
  'is',
  'up',
  '12%',
  '.',
  'Decision',
  'queue',
  'has',
  '4',
  'pending',
  '.',
];

describe('AdaptiveStreamController', () => {
  it('starts in micro mode', () => {
    const c = createAdaptiveStreamController();
    expect(c.currentMode()).toBe('micro');
  });

  it('emits one word per chunk in micro mode', () => {
    const c = createAdaptiveStreamController();
    c.push('Hello');
    c.push('world');
    const a = c.pull();
    const b = c.pull();
    expect(a?.text).toBe('Hello');
    expect(b?.text).toBe('world');
    expect(a?.batched).toBe(false);
    expect(a?.chunkNo).toBe(1);
    expect(b?.chunkNo).toBe(2);
  });

  it('transitions to batch when lag exceeds threshold', () => {
    const c = createAdaptiveStreamController({
      lagBatchThreshold: 3,
      lagMicroThreshold: 1,
    });
    // Push & pull 4 chunks without ACKing → lag goes 1,2,3,4.
    for (let i = 0; i < 4; i += 1) {
      c.push(WORDS[i]!);
      c.pull();
    }
    expect(c.lag()).toBe(4);
    // The next pull, with 2 pending words and lag=4 ≥ threshold=3,
    // should batch.
    c.push('still');
    c.push('lagging');
    const next = c.pull();
    expect(next?.batched).toBe(true);
    expect(next?.text).toContain('still');
    expect(next?.text).toContain('lagging');
    expect(c.currentMode()).toBe('batch');
  });

  it('returns to micro mode when lag drops below threshold', () => {
    const c = createAdaptiveStreamController({
      lagBatchThreshold: 3,
      lagMicroThreshold: 1,
    });
    // Build lag.
    for (let i = 0; i < 4; i += 1) {
      c.push(WORDS[i]!);
      c.pull();
    }
    // Force batch mode.
    c.push('extra');
    c.pull();
    expect(c.currentMode()).toBe('batch');
    // ACK enough chunks to drop lag below threshold.
    c.ack(5);
    expect(c.lag()).toBe(0);
    expect(c.currentMode()).toBe('micro');
  });

  it('returns null on pull with no pending words', () => {
    const c = createAdaptiveStreamController();
    expect(c.pull()).toBeNull();
  });

  it('idempotent ack — out-of-order ack is ignored', () => {
    const c = createAdaptiveStreamController();
    c.push('a');
    c.push('b');
    c.pull();
    c.pull();
    c.ack(2);
    c.ack(1); // earlier — should be ignored.
    expect(c.lag()).toBe(0);
  });

  it('recommended delay reflects mode', () => {
    const c = createAdaptiveStreamController({
      microDelayMs: 100,
      lagBatchThreshold: 1,
    });
    expect(c.recommendedDelayMs()).toBe(100);
    c.push('x');
    c.pull();
    c.push('y');
    c.pull();
    expect(c.currentMode()).toBe('batch');
    expect(c.recommendedDelayMs()).toBe(0);
  });
});
