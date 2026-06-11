/**
 * retry-policy.ts tests — bounded retry, transient-vs-fatal
 * classification, exponential backoff, never-throws contract.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  retryAction,
  defaultIsTransient,
  backoffForAttempt,
  DEFAULT_DRIVER_RETRY_POLICY,
} from '../retry-policy.js';
import type { ActionResult } from '../legacy-portal-driver.js';

const instantSleep = async (): Promise<void> => undefined;

function result(ok: boolean, reason?: string): ActionResult {
  return {
    ok,
    verb: 'click',
    ...(reason !== undefined ? { reason } : {}),
    postActionSnapshot: {
      capturedAt: new Date().toISOString(),
      nodeCount: 0,
      truncated: false,
      root: null,
    },
    diff: { added: [], removed: [], changed: [], identical: true },
  };
}

describe('defaultIsTransient', () => {
  it('classifies timeouts/network as transient', () => {
    expect(defaultIsTransient('timeout 5000ms exceeded')).toBe(true);
    expect(defaultIsTransient('ECONNRESET')).toBe(true);
    expect(defaultIsTransient('network error')).toBe(true);
  });
  it('classifies control-not-found / ambiguous as fatal', () => {
    expect(defaultIsTransient('control-not-found')).toBe(false);
    expect(defaultIsTransient('control-ambiguous')).toBe(false);
    expect(defaultIsTransient('captcha-required')).toBe(false);
  });
  it('treats an unknown / empty reason as transient (one more shot)', () => {
    expect(defaultIsTransient(undefined)).toBe(true);
    expect(defaultIsTransient('weird vendor string')).toBe(true);
  });
});

describe('backoffForAttempt', () => {
  it('grows exponentially and respects the cap', () => {
    const p = DEFAULT_DRIVER_RETRY_POLICY;
    expect(backoffForAttempt(1, p)).toBe(100);
    expect(backoffForAttempt(2, p)).toBe(200);
    expect(backoffForAttempt(3, p)).toBe(400);
    expect(backoffForAttempt(99, p)).toBe(p.backoffCapMs);
  });
});

describe('retryAction', () => {
  it('retries a transient failure then succeeds on attempt 2', async () => {
    const action = vi
      .fn<[], Promise<ActionResult>>()
      .mockResolvedValueOnce(result(false, 'timeout 5000ms exceeded'))
      .mockResolvedValueOnce(result(true));
    const out = await retryAction(action, { sleep: instantSleep });
    expect(action).toHaveBeenCalledTimes(2);
    expect(out.ok).toBe(true);
  });

  it('fails fast on a fatal reason (no retries)', async () => {
    const action = vi
      .fn<[], Promise<ActionResult>>()
      .mockResolvedValue(result(false, 'control-not-found'));
    const out = await retryAction(action, { sleep: instantSleep });
    expect(action).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('control-not-found');
  });

  it('exhausts attempts and surfaces max-retries-exhausted (never throws)', async () => {
    const action = vi
      .fn<[], Promise<ActionResult>>()
      .mockResolvedValue(result(false, 'timeout 5000ms exceeded'));
    const out = await retryAction(action, { sleep: instantSleep });
    expect(action).toHaveBeenCalledTimes(
      DEFAULT_DRIVER_RETRY_POLICY.maxAttempts,
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/^max-retries-exhausted:/);
  });

  it('catches a thrown error and surfaces it structurally', async () => {
    const action = vi
      .fn<[], Promise<ActionResult>>()
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValueOnce(result(true));
    const out = await retryAction(action, { sleep: instantSleep });
    expect(out.ok).toBe(true);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('reports each attempt to the onAttempt observer', async () => {
    const seen: Array<{ attempt: number; ok: boolean }> = [];
    const action = vi
      .fn<[], Promise<ActionResult>>()
      .mockResolvedValueOnce(result(false, 'timeout'))
      .mockResolvedValueOnce(result(true));
    await retryAction(action, {
      sleep: instantSleep,
      onAttempt: (info) => seen.push({ attempt: info.attempt, ok: info.ok }),
    });
    expect(seen).toEqual([
      { attempt: 1, ok: false },
      { attempt: 2, ok: true },
    ]);
  });
});
