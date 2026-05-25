/**
 * Retry failed notifications
 */

import { Queue } from 'bullmq';
import type { NotificationJobData } from './producer.js';
import { getNotificationQueue } from './producer.js';
import { createLogger } from '../logger.js';

const logger = createLogger('notification-retry');

export interface RetryOptions {
  maxAttempts?: number;
  jobIds?: string[];
  /**
   * Maximum number of failed jobs to inspect per call. Round-3 audit
   * M11 — the previous implementation called `queue.getFailed()` with
   * NO arguments, which pulled every failed job into memory. A deeply
   * failed queue (a misconfigured provider that has been rejecting
   * for hours) could load tens of thousands of rows, OOM the worker,
   * and bring down the whole consumer fleet.
   *
   * The default page size (500) caps memory at a few MB. Pass a
   * larger value for one-shot admin scripts that know the queue is
   * small.
   */
  pageSize?: number;
  /** Maximum total jobs to inspect across all pages. Default: 5000. */
  maxJobsToInspect?: number;
}

const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_JOBS = 5_000;

/**
 * Retry failed jobs in the notifications queue.
 *
 * Round-3 audit M11 — paginated via `getFailed(start, end)`. BullMQ
 * uses inclusive zero-indexed ranges; we stride one page at a time.
 */
export async function retryFailedNotifications(
  options?: RetryOptions
): Promise<{ retried: number; failed: string[]; inspected: number }> {
  const queue = getNotificationQueue();
  const failed: string[] = [];
  let retried = 0;
  let inspected = 0;
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxJobs = options?.maxJobsToInspect ?? DEFAULT_MAX_JOBS;
  const maxAttempts = options?.maxAttempts ?? 3;

  try {
    for (let start = 0; start < maxJobs; start += pageSize) {
      const end = Math.min(start + pageSize - 1, maxJobs - 1);
      const page = await queue.getFailed(start, end);
      if (page.length === 0) break;
      inspected += page.length;

      for (const job of page) {
        const jobId = job.id;
        if (options?.jobIds && jobId && !options.jobIds.includes(jobId)) {
          continue;
        }

        if (job.attemptsMade >= maxAttempts) {
          logger.warn('Skipping job - max attempts reached', {
            jobId,
            attemptsMade: job.attemptsMade,
          });
          failed.push(jobId ?? '');
          continue;
        }

        try {
          await job.retry();
          retried++;
          logger.info('Retried failed job', { jobId });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Failed to retry job', { jobId, error: msg });
          failed.push(jobId ?? '');
        }
      }

      if (page.length < pageSize) break;
    }

    return { retried, failed, inspected };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Error retrying failed notifications', { error: msg });
    throw err;
  }
}

/**
 * Get failed job details for inspection. Round-3 audit M11 — supports
 * pagination so an admin UI can page through the DLQ without loading
 * everything at once.
 */
export async function getFailedJobs(
  options: { start?: number; end?: number } = {}
): Promise<
  Array<{
    id: string;
    data: NotificationJobData;
    attemptsMade: number;
    failedReason?: string;
    timestamp: number;
  }>
> {
  const queue = getNotificationQueue();
  const start = options.start ?? 0;
  const end = options.end ?? start + DEFAULT_PAGE_SIZE - 1;
  const failedJobs = await queue.getFailed(start, end);

  return failedJobs.map((job) => ({
    id: job.id ?? '',
    data: job.data,
    attemptsMade: job.attemptsMade ?? 0,
    failedReason: job.failedReason,
    timestamp: job.timestamp ?? 0,
  }));
}
