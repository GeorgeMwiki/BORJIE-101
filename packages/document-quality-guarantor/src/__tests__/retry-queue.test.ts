/**
 * Retry-queue tests — idempotency, dequeue/ack-success, backoff order,
 * DLQ on max-attempts, visibility-timeout recovery.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryAuditChainStore } from '../audit/index.js';
import {
  createInMemoryRetryQueue,
  expectedSeries,
  nextDelayMs,
} from '../retry-queue/index.js';
import type { RetryPolicy } from '../types.js';
import { DEFAULT_RETRY_POLICY } from '../types.js';

function makeClock(start: number) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('nextDelayMs / expectedSeries', () => {
  it('produces a geometric series with the default policy', () => {
    const series = expectedSeries(DEFAULT_RETRY_POLICY);
    expect(series).toEqual([1000, 5000, 25000, 125000]);
  });

  it('honors jitter ratio symmetrically around the base delay', () => {
    const policy: RetryPolicy = {
      maxAttempts: 3,
      baseDelayMs: 1000,
      multiplier: 2,
      jitterRatio: 0.2,
    };
    // With zero-mean jitter and ratio 0.2, the delay stays in
    // [base * 0.9, base * 1.1] (centered span ±0.5 * ratio).
    const r0 = nextDelayMs(policy, 1, () => 0); // jitter = -0.5 * span
    const r1 = nextDelayMs(policy, 1, () => 1); // jitter = +0.5 * span
    const r05 = nextDelayMs(policy, 1, () => 0.5); // jitter = 0
    expect(r05).toBe(1000);
    expect(r0).toBe(900);
    expect(r1).toBe(1100);
  });
});

describe('createInMemoryRetryQueue', () => {
  let audit = createInMemoryAuditChainStore();
  beforeEach(() => {
    audit = createInMemoryAuditChainStore();
  });

  it('deduplicates jobs on idempotencyKey', async () => {
    const queue = createInMemoryRetryQueue({ audit });
    const a = await queue.enqueueJob({
      kind: 'intake_extract',
      payload: { foo: 1 },
      tenantId: 't-1',
      idempotencyKey: 'key-1',
    });
    const b = await queue.enqueueJob({
      kind: 'intake_extract',
      payload: { foo: 2 }, // different payload — dedup wins
      tenantId: 't-1',
      idempotencyKey: 'key-1',
    });
    expect(a.id).toBe(b.id);
    expect(queue.pendingCount()).toBe(1);
  });

  it('dequeueNext leases a job and acknowledgeSuccess marks it complete', async () => {
    const queue = createInMemoryRetryQueue({ audit });
    await queue.enqueueJob({
      kind: 'intake_extract',
      payload: {},
      tenantId: 't-1',
      idempotencyKey: 'key-1',
    });
    const leased = await queue.dequeueNext('worker-1');
    expect(leased).not.toBeNull();
    await queue.acknowledgeSuccess(leased!.job.id, {});
    expect(queue.pendingCount()).toBe(0);
    const next = await queue.dequeueNext('worker-1');
    expect(next).toBeNull();
  });

  it('exponential backoff: nextRunAtMs grows with each failure', async () => {
    const clock = makeClock(0);
    const policy: RetryPolicy = {
      maxAttempts: 4,
      baseDelayMs: 1000,
      multiplier: 5,
      jitterRatio: 0, // deterministic
    };
    const queue = createInMemoryRetryQueue({
      audit,
      nowMs: clock.now,
      random: () => 0.5,
    });
    await queue.enqueueJob({
      kind: 'intake_extract',
      payload: {},
      tenantId: 't-1',
      idempotencyKey: 'k',
      retryPolicy: policy,
    });
    const first = await queue.dequeueNext('w');
    await queue.acknowledgeFailure(first!.job.id, 'transient');
    clock.advance(0);
    const after1 = (await queue.dequeueNext('w')); // not yet visible
    expect(after1).toBeNull();
    clock.advance(1000);
    const second = await queue.dequeueNext('w');
    expect(second).not.toBeNull();
    await queue.acknowledgeFailure(second!.job.id, 'transient');
    clock.advance(5000);
    const third = await queue.dequeueNext('w');
    expect(third).not.toBeNull();
  });

  it('DLQ on max attempts and onDlq hook fires', async () => {
    const onDlq = vi.fn(async () => undefined);
    const clock = makeClock(0);
    const queue = createInMemoryRetryQueue({
      audit,
      nowMs: clock.now,
      random: () => 0.5,
      onDlq,
    });
    const policy: RetryPolicy = {
      maxAttempts: 2,
      baseDelayMs: 1,
      multiplier: 2,
      jitterRatio: 0,
    };
    await queue.enqueueJob({
      kind: 'intake_extract',
      payload: {},
      tenantId: 't-1',
      idempotencyKey: 'k',
      retryPolicy: policy,
    });
    const lease1 = await queue.dequeueNext('w');
    await queue.acknowledgeFailure(lease1!.job.id, 'err1');
    clock.advance(10);
    const lease2 = await queue.dequeueNext('w');
    await queue.acknowledgeFailure(lease2!.job.id, 'err2');
    expect(queue.dlqCount()).toBe(1);
    expect(onDlq).toHaveBeenCalledOnce();
  });

  it('non-retryable failure jumps straight to DLQ', async () => {
    const onDlq = vi.fn(async () => undefined);
    const queue = createInMemoryRetryQueue({ audit, onDlq });
    await queue.enqueueJob({
      kind: 'intake_extract',
      payload: {},
      tenantId: 't-1',
      idempotencyKey: 'k',
    });
    const leased = await queue.dequeueNext('w');
    await queue.acknowledgeFailure(leased!.job.id, 'permanent', false);
    expect(queue.dlqCount()).toBe(1);
    expect(onDlq).toHaveBeenCalledOnce();
  });

  it('visibility timeout returns crashed-worker job to the queue', async () => {
    const clock = makeClock(0);
    const queue = createInMemoryRetryQueue({
      audit,
      nowMs: clock.now,
      visibilityTimeoutMs: 100,
    });
    await queue.enqueueJob({
      kind: 'intake_extract',
      payload: {},
      tenantId: 't-1',
      idempotencyKey: 'k',
    });
    const first = await queue.dequeueNext('w-1');
    expect(first).not.toBeNull();
    // Worker crashed without acking. After visibility timeout the
    // job is visible to a second worker.
    clock.advance(101);
    const second = await queue.dequeueNext('w-2');
    expect(second).not.toBeNull();
    expect(second!.job.id).toBe(first!.job.id);
  });
});
