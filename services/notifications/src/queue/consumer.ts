/**
 * Notification queue consumer - process jobs with BullMQ
 */

import { Worker, type Job } from 'bullmq';
import type { NotificationJobData } from './producer.js';
import { notificationProcessor } from '../services/notification.service.js';
import { createLogger } from '../logger.js';

const logger = createLogger('notification-consumer');

export interface ConsumerOptions {
  connection?: { host: string; port: number; password?: string };
  queueName?: string;
  concurrency?: number;
}

const DEFAULT_QUEUE_NAME = 'notifications';

function getDefaultConnection(): { host: string; port: number; password?: string } {
  const url = process.env['REDIS_URL'];
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
    throw new Error('REDIS_URL is required in production for the notification queue');
  }
  return { host: 'localhost', port: 6379 };
}

let workerInstance: Worker<NotificationJobData> | null = null;

/**
 * Process a single notification job
 */
async function processNotificationJob(job: Job<NotificationJobData>): Promise<void> {
  const { recipient, channel, templateId, data, notificationId } = job.data;

  logger.info('Processing notification job', {
    jobId: job.id,
    notificationId,
    channel,
    templateId,
  });

  const result = await notificationProcessor.sendNotification(
    recipient,
    channel,
    templateId,
    data
  );

  if (!result.success) {
    logger.warn('Notification job failed', {
      jobId: job.id,
      error: result.error,
    });
    throw new Error(result.error ?? 'Notification send failed');
  }

  logger.info('Notification job completed', {
    jobId: job.id,
    notificationId: result.id,
  });
}

/**
 * Create and start the notification queue worker
 */
export function createNotificationWorker(
  options?: ConsumerOptions
): Worker<NotificationJobData> {
  if (workerInstance) {
    return workerInstance;
  }

  const connection = options?.connection ?? getDefaultConnection();
  const queueName = options?.queueName ?? DEFAULT_QUEUE_NAME;
  const concurrency = options?.concurrency ?? 5;

  workerInstance = new Worker<NotificationJobData>(
    queueName,
    async (job) => processNotificationJob(job),
    {
      connection,
      concurrency,
    }
  );

  workerInstance.on('completed', (job) => {
    logger.debug('Job completed', { jobId: job.id });
  });

  workerInstance.on('failed', (job, err) => {
    logger.error('Job failed', {
      jobId: job?.id,
      error: err?.message,
      attemptsMade: job?.attemptsMade,
    });
  });

  workerInstance.on('error', (err) => {
    logger.error('Worker error', { error: err.message });
  });

  return workerInstance;
}

/**
 * Stop the notification queue consumer (graceful shutdown)
 */
export async function stopNotificationConsumer(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
  }
}
