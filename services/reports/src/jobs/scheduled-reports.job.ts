/**
 * Scheduled Report Generation Job
 * Uses BullMQ for cron-based report generation. REDIS_URL required in production.
 */

import { Queue, Worker } from 'bullmq';
import type { ReportFormat, ScheduledReportConfig } from '../types/index.js';

export interface ScheduledReportJobData {
  tenantId: string;
  config: ScheduledReportConfig;
  reportData: Record<string, unknown>;
}

export interface ReportDeliveryJobData {
  reportId: string;
  format: ReportFormat;
  buffer: Buffer;
  recipients: string[];
  subject: string;
}

function getRedisConnection(): { host: string; port: number; password?: string } {
  const url = process.env.REDIS_URL;
  if (url) {
    try {
      const u = new URL(url);
      return {
        host: u.hostname,
        port: parseInt(u.port ?? '6379', 10),
        password: u.password || undefined,
      };
    } catch {
      // invalid URL
    }
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('REDIS_URL is required in production for scheduled reports');
  }
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD,
  };
}

const REDIS_OPTS = { connection: getRedisConnection() };

export function createReportQueue(): Queue<ScheduledReportJobData> {
  return new Queue<ScheduledReportJobData>('scheduled-reports', REDIS_OPTS);
}

/**
 * Concurrency cap for report generation. Reports build PDFs + query
 * wide ranges of data, so each job can spike CPU and open many DB
 * connections. A low default keeps the worker responsive and avoids
 * swamping Postgres. Override via REPORTS_WORKER_CONCURRENCY for
 * scale-out deployments with a larger DB pool.
 */
const DEFAULT_WORKER_CONCURRENCY = 4;

function parseConcurrency(): number {
  const raw = process.env.REPORTS_WORKER_CONCURRENCY;
  if (!raw) return DEFAULT_WORKER_CONCURRENCY;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_WORKER_CONCURRENCY;
  return Math.min(n, 32);
}

export function createReportWorker(
  processReport: (job: ScheduledReportJobData) => Promise<Buffer>
): Worker<ScheduledReportJobData> {
  return new Worker<ScheduledReportJobData>(
    'scheduled-reports',
    async (job) => processReport(job.data),
    {
      ...REDIS_OPTS,
      concurrency: parseConcurrency(),
    }
  );
}

export function scheduleReport(
  queue: Queue<ScheduledReportJobData>,
  data: ScheduledReportJobData,
  cronExpression: string
): Promise<unknown> {
  return queue.add('generate-report', data, {
    repeat: { pattern: cronExpression },
    // Retry failed generations up to 3× with exponential backoff, then
    // move to dead-letter so a single broken cron doesn't flood the queue.
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 100, age: 24 * 3600 },
    removeOnFail: { count: 200 },
  });
}
