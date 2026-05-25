/**
 * In-memory notification history repository
 * Replace with DB (e.g. Drizzle/Prisma) for production
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  NotificationHistoryRecord,
  NotificationChannel,
  NotificationTemplateId,
} from '../types/index.js';

const history: NotificationHistoryRecord[] = [];
const scheduled: Map<string, { scheduledAt: Date; fn: () => Promise<void> }> = new Map();

export interface NotificationHistoryOptions {
  tenantId: string;
  customerId?: string;
  limit?: number;
  offset?: number;
}

export function addHistoryRecord(record: Omit<NotificationHistoryRecord, 'id' | 'createdAt'>): string {
  const id = uuidv4();
  history.push({
    ...record,
    id,
    createdAt: new Date(),
  });
  return id;
}

export function updateHistoryRecord(
  id: string,
  updates: Partial<Pick<NotificationHistoryRecord, 'status' | 'externalId' | 'error' | 'sentAt'>>
): void {
  const idx = history.findIndex((r) => r.id === id);
  if (idx >= 0) {
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    ) as Partial<Pick<NotificationHistoryRecord, 'status' | 'externalId' | 'error' | 'sentAt'>>;
    history[idx] = { ...history[idx], ...filtered } as NotificationHistoryRecord;
  }
}

export function getNotificationHistory(
  options: NotificationHistoryOptions
): NotificationHistoryRecord[] {
  let filtered = history.filter((r) => r.tenantId === options.tenantId);
  if (options.customerId) {
    filtered = filtered.filter((r) => r.customerId === options.customerId);
  }
  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 50;
  return filtered.slice(offset, offset + limit);
}

export function getNotificationById(id: string): NotificationHistoryRecord | undefined {
  return history.find((r) => r.id === id);
}

export function addScheduled(
  id: string,
  scheduledAt: Date,
  fn: () => Promise<void>
): void {
  scheduled.set(id, { scheduledAt, fn });
}

export function getScheduled(id: string): { scheduledAt: Date; fn: () => Promise<void> } | undefined {
  return scheduled.get(id);
}

export function removeScheduled(id: string): void {
  scheduled.delete(id);
}
