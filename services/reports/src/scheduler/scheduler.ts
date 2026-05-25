/**
 * Report scheduler - Schedule recurring reports
 */

import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import type { ReportType } from '../reports/report-types.js';
import type { ReportFormat } from '../reports/report-types.js';

export interface ScheduleConfig {
  cron: string;
  recipients: string[];
  format: ReportFormat;
}

export interface ScheduledReport {
  id: string;
  tenantId: string;
  reportType: ReportType;
  schedule: ScheduleConfig;
  params: Record<string, unknown>;
  createdAt: Date;
  bullJobId?: string;
}

export interface ReportSchedulerOptions {
  redis?: {
    host?: string;
    port?: number;
    password?: string;
  };
}

function getDefaultRedis(): { host: string; port: number; password?: string } {
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
    throw new Error('REDIS_URL is required in production for report scheduler');
  }
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD,
  };
}
const DEFAULT_REDIS = getDefaultRedis();

export class ReportScheduler {
  private queue: Queue;
  private schedules: Map<string, ScheduledReport> = new Map();

  constructor(options: ReportSchedulerOptions = {}) {
    const redis = { ...DEFAULT_REDIS, ...options.redis };
    this.queue = new Queue('scheduled-reports', {
      connection: redis,
    });
  }

  async scheduleReport(
    tenantId: string,
    reportType: ReportType,
    params: Record<string, unknown>,
    schedule: ScheduleConfig
  ): Promise<ScheduledReport> {
    const id = uuidv4();
    const scheduled: ScheduledReport = {
      id,
      tenantId,
      reportType,
      schedule,
      params,
      createdAt: new Date(),
    };

    const job = await this.queue.add(
      'generate-scheduled-report',
      {
        scheduleId: id,
        tenantId,
        reportType,
        params,
        recipients: schedule.recipients,
        format: schedule.format,
      },
      {
        repeat: { pattern: schedule.cron },
        jobId: id,
      }
    );

    scheduled.bullJobId = job.id;
    this.schedules.set(id, scheduled);
    return scheduled;
  }

  async cancelSchedule(scheduleId: string): Promise<boolean> {
    const scheduled = this.schedules.get(scheduleId);
    if (!scheduled) return false;

    try {
      const repeatableJobs = await this.queue.getRepeatableJobs();
      const job = repeatableJobs.find(
        (j) => j.id === scheduleId || j.key?.includes(scheduleId)
      );
      if (job) {
        await this.queue.removeRepeatableByKey(job.key);
      }
    } catch {
      // Job may not exist
    }

    this.schedules.delete(scheduleId);
    return true;
  }

  async getSchedule(scheduleId: string): Promise<ScheduledReport | null> {
    return this.schedules.get(scheduleId) ?? null;
  }

  async listSchedules(tenantId?: string): Promise<ScheduledReport[]> {
    let results = Array.from(this.schedules.values());
    if (tenantId) {
      results = results.filter((r) => r.tenantId === tenantId);
    }
    return results.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  getQueue(): Queue {
    return this.queue;
  }
}
