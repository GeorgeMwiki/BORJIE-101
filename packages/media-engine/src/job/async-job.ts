/**
 * Async job model.
 *
 * Real video/image generation is asynchronous: submit → poll → download.
 * This module defines the job ADT + an in-memory job store so a host can
 * run the engine in 202-accepted mode (return a `job_id`, poll later)
 * without binding to a queue. The engine's synchronous `generate()` path
 * can also be wrapped into a job for uniform delivery.
 *
 * Job state is immutable: every transition returns a NEW job record.
 *
 * @module @borjie/media-engine/job/async-job
 */

import type { MediaArtifact, MediaErrorCode } from '../types.js';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface MediaJob {
  readonly id: string;
  readonly tenantId: string;
  readonly status: JobStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Present on `succeeded`. */
  readonly artifact?: MediaArtifact;
  /** Present on `failed`. */
  readonly errorCode?: MediaErrorCode;
  readonly errorMessage?: string;
}

export interface MediaJobStore {
  create(tenantId: string, jobId: string, at: string): MediaJob;
  markRunning(jobId: string, at: string): MediaJob | null;
  succeed(jobId: string, artifact: MediaArtifact, at: string): MediaJob | null;
  fail(
    jobId: string,
    errorCode: MediaErrorCode,
    errorMessage: string,
    at: string,
  ): MediaJob | null;
  get(jobId: string): MediaJob | null;
}

/** In-memory, immutable-transition job store. */
export function createInMemoryJobStore(): MediaJobStore {
  const jobs = new Map<string, MediaJob>();

  const transition = (
    jobId: string,
    patch: (job: MediaJob) => MediaJob,
  ): MediaJob | null => {
    const current = jobs.get(jobId);
    if (!current) return null;
    const next = patch(current);
    jobs.set(jobId, next);
    return next;
  };

  return {
    create(tenantId: string, jobId: string, at: string): MediaJob {
      const job: MediaJob = {
        id: jobId,
        tenantId,
        status: 'queued',
        createdAt: at,
        updatedAt: at,
      };
      jobs.set(jobId, job);
      return job;
    },
    markRunning: (jobId, at) =>
      transition(jobId, (job) => ({
        ...job,
        status: 'running',
        updatedAt: at,
      })),
    succeed: (jobId, artifact, at) =>
      transition(jobId, (job) => ({
        ...job,
        status: 'succeeded',
        artifact,
        updatedAt: at,
      })),
    fail: (jobId, errorCode, errorMessage, at) =>
      transition(jobId, (job) => ({
        ...job,
        status: 'failed',
        errorCode,
        errorMessage,
        updatedAt: at,
      })),
    get: (jobId) => jobs.get(jobId) ?? null,
  };
}
