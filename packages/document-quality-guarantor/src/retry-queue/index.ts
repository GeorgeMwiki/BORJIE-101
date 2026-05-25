/**
 * Idempotent retry queue with exponential-backoff + DLQ.
 *
 * In-memory default; a `RetryQueueStore` port lets production swap
 * a Postgres- or Redis-backed implementation in. Visibility-timeout
 * leases keep crashed workers from blocking jobs forever.
 *
 * Idempotency: `enqueueJob` dedups on `idempotencyKey`. A second
 * call with the same key returns the existing job (the Trigger.dev
 * v3 pattern — see Docs/DOCUMENT_QUALITY_RESEARCH_2026-05-24.md §5).
 *
 * After `maxAttempts` failures the job moves to the DLQ and an
 * audit `retry_dlq` event is appended. Callers wire `onDlq` to fire
 * escalation when DLQ is hit.
 */

import type { AuditChainStore } from '../audit/index.js';
import type {
  IdempotencyKey,
  Job,
  JobId,
  JobKind,
  JobOutcome,
  RetryPolicy,
  TenantId,
} from '../types.js';
import { DEFAULT_RETRY_POLICY } from '../types.js';
import { nextDelayMs } from './backoff.js';

export interface EnqueueJobInput {
  readonly kind: JobKind;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly tenantId: TenantId;
  readonly idempotencyKey: IdempotencyKey;
  readonly retryPolicy?: RetryPolicy;
}

export interface LeasedJob {
  readonly job: Job;
  readonly leaseUntilMs: number;
}

export interface RetryQueueDeps {
  readonly audit: AuditChainStore;
  /** Override clock for tests; defaults to Date.now(). */
  readonly nowMs?: () => number;
  readonly random?: () => number;
  /** Default visibility-timeout ms for a dequeued job. Default 30 000. */
  readonly visibilityTimeoutMs?: number;
  /** Called when a job exhausts its retries (poison message). */
  readonly onDlq?: (job: Job, lastError: string) => Promise<void>;
}

export interface RetryQueue {
  enqueueJob(input: EnqueueJobInput): Promise<Job>;
  dequeueNext(workerId: string): Promise<LeasedJob | null>;
  acknowledgeSuccess(jobId: JobId, result: Readonly<Record<string, unknown>>): Promise<void>;
  acknowledgeFailure(jobId: JobId, error: string, retryable?: boolean): Promise<void>;
  /** Inspection / dashboards. */
  pendingCount(): number;
  dlqCount(): number;
  listDlq(): ReadonlyArray<Job>;
}

// Mutable shadow of `Job` — the public `Job` shape is fully readonly,
// so the internal store needs a writable mirror to track per-attempt
// state transitions without leaking mutability out the public API.
interface InternalJob {
  id: JobId;
  kind: JobKind;
  idempotencyKey: IdempotencyKey;
  payload: Readonly<Record<string, unknown>>;
  tenantId: TenantId;
  attempts: number;
  nextRunAtMs: number;
  retryPolicy: RetryPolicy;
  createdAtMs: number;
  state: 'pending' | 'leased' | 'completed' | 'dead';
  leaseHolder: string | null;
  leaseUntilMs: number | null;
  lastError: string | null;
}

export function createInMemoryRetryQueue(deps: RetryQueueDeps): RetryQueue {
  const now = deps.nowMs ?? (() => Date.now());
  const random = deps.random ?? Math.random;
  const visibilityTimeoutMs = deps.visibilityTimeoutMs ?? 30_000;

  const byId = new Map<JobId, InternalJob>();
  const byIdempotency = new Map<IdempotencyKey, JobId>();
  const dlq: InternalJob[] = [];
  let counter = 0;

  function snap(j: InternalJob): Job {
    return {
      id: j.id,
      kind: j.kind,
      idempotencyKey: j.idempotencyKey,
      payload: j.payload,
      tenantId: j.tenantId,
      attempts: j.attempts,
      nextRunAtMs: j.nextRunAtMs,
      retryPolicy: j.retryPolicy,
      createdAtMs: j.createdAtMs,
    };
  }

  return {
    pendingCount: () =>
      Array.from(byId.values()).filter((j) => j.state === 'pending' || j.state === 'leased').length,
    dlqCount: () => dlq.length,
    listDlq: () => Object.freeze(dlq.map(snap)),

    async enqueueJob(input) {
      const existingId = byIdempotency.get(input.idempotencyKey);
      if (existingId !== undefined) {
        const existing = byId.get(existingId);
        if (existing !== undefined) return snap(existing);
      }
      counter += 1;
      const id: JobId = `job-${now()}-${counter}`;
      const internal: InternalJob = {
        id,
        kind: input.kind,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
        tenantId: input.tenantId,
        attempts: 0,
        nextRunAtMs: now(),
        retryPolicy: input.retryPolicy ?? DEFAULT_RETRY_POLICY,
        createdAtMs: now(),
        state: 'pending',
        leaseHolder: null,
        leaseUntilMs: null,
        lastError: null,
      };
      byId.set(id, internal);
      byIdempotency.set(input.idempotencyKey, id);
      return snap(internal);
    },

    async dequeueNext(workerId) {
      const candidate = Array.from(byId.values())
        .filter((j) => {
          if (j.state === 'completed' || j.state === 'dead') return false;
          if (j.state === 'leased') {
            if (j.leaseUntilMs === null || j.leaseUntilMs <= now()) {
              // Lease expired; job becomes visible again.
              j.state = 'pending';
              j.leaseHolder = null;
              j.leaseUntilMs = null;
              return j.nextRunAtMs <= now();
            }
            return false;
          }
          return j.nextRunAtMs <= now();
        })
        .sort((a, b) => a.nextRunAtMs - b.nextRunAtMs)[0];
      if (candidate === undefined) return null;
      candidate.state = 'leased';
      candidate.leaseHolder = workerId;
      candidate.leaseUntilMs = now() + visibilityTimeoutMs;
      return { job: snap(candidate), leaseUntilMs: candidate.leaseUntilMs };
    },

    async acknowledgeSuccess(jobId, _result) {
      const j = byId.get(jobId);
      if (j === undefined) return;
      j.state = 'completed';
      j.leaseHolder = null;
      j.leaseUntilMs = null;
    },

    async acknowledgeFailure(jobId, error, retryable = true) {
      const j = byId.get(jobId);
      if (j === undefined) return;
      j.attempts += 1;
      j.lastError = error;
      j.leaseHolder = null;
      j.leaseUntilMs = null;
      const policy = j.retryPolicy;
      const exhausted = !retryable || j.attempts >= policy.maxAttempts;
      if (exhausted) {
        j.state = 'dead';
        dlq.push(j);
        await deps.audit.append({
          tenantId: j.tenantId,
          kind: 'retry_dlq',
          operationId: j.id,
          engineId: null,
          details: { idempotencyKey: j.idempotencyKey, lastError: error, attempts: j.attempts },
          recordedAtIso: new Date().toISOString(),
        });
        if (deps.onDlq !== undefined) await deps.onDlq(snap(j), error);
        return;
      }
      const delay = nextDelayMs(policy, j.attempts, random);
      j.state = 'pending';
      j.nextRunAtMs = now() + delay;
      await deps.audit.append({
        tenantId: j.tenantId,
        kind: 'retry_scheduled',
        operationId: j.id,
        engineId: null,
        details: {
          idempotencyKey: j.idempotencyKey,
          attempt: j.attempts,
          nextDelayMs: delay,
          error,
        },
        recordedAtIso: new Date().toISOString(),
      });
    },
  };
}

export { nextDelayMs, expectedSeries } from './backoff.js';
export type { JobOutcome };
