/**
 * Notification queue producer - add jobs to BullMQ queue
 */

import { Queue } from 'bullmq';
import type { NotificationRecipient } from '../types/index.js';
import type { NotificationChannel, NotificationTemplateId } from '../types/index.js';

export interface NotificationJobData {
  recipient: NotificationRecipient;
  channel: NotificationChannel;
  templateId: NotificationTemplateId;
  data: Record<string, string>;
  notificationId?: string;
}

export interface QueueOptions {
  connection?: { host: string; port: number; password?: string };
  queueName?: string;
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

let queueInstance: Queue<NotificationJobData> | null = null;

/**
 * Get or create the notification queue
 */
export function getNotificationQueue(options?: QueueOptions): Queue<NotificationJobData> {
  if (queueInstance) {
    return queueInstance;
  }

  const connection = options?.connection ?? getDefaultConnection();
  const queueName = options?.queueName ?? DEFAULT_QUEUE_NAME;

  queueInstance = new Queue<NotificationJobData>(queueName, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });

  return queueInstance;
}

/**
 * Add a notification to the queue
 */
export async function addToQueue(
  data: NotificationJobData,
  options?: { delay?: number; priority?: number }
): Promise<string> {
  const queue = getNotificationQueue();
  const job = await queue.add('send-notification', data, {
    delay: options?.delay,
    priority: options?.priority,
  });
  return job.id ?? '';
}

/**
 * Add bulk notifications to the queue
 */
export async function addBulkToQueue(
  items: NotificationJobData[],
  options?: { delay?: number }
): Promise<string[]> {
  const queue = getNotificationQueue();
  const jobs = await queue.addBulk(
    items.map((data, index) => ({
      name: 'send-notification',
      data,
      opts: {
        delay: options?.delay,
        priority: index,
      },
    }))
  );
  return jobs.map((j) => j.id ?? '');
}
