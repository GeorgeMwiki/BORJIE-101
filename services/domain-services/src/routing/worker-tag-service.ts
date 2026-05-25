/**
 * Worker Tag Service (NEW 18)
 *
 * CRUD over worker_tags. Tag immutability is enforced by creating new
 * rows rather than mutating; removal is a hard delete to keep indexes
 * small (audit trail lives in audit-events).
 */

import { randomBytes } from 'node:crypto';
import type { WorkerTag, WorkerTagRepository } from './types.js';

function defaultId(): string {
  return `wtag_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

export class WorkerTagService {
  constructor(
    private readonly repository: WorkerTagRepository,
    private readonly generateId: () => string = defaultId
  ) {}

  async listForUser(
    tenantId: string,
    userId: string
  ): Promise<readonly WorkerTag[]> {
    return this.repository.listForUser(tenantId, userId);
  }

  async addTag(input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly tag: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly createdBy: string;
  }): Promise<WorkerTag> {
    if (!input.tag.trim()) {
      throw new Error('Tag must be non-empty');
    }
    return this.repository.add({
      tenantId: input.tenantId,
      userId: input.userId,
      tag: input.tag.trim(),
      metadata: input.metadata ?? {},
      createdBy: input.createdBy,
    });
  }

  async removeTag(tenantId: string, tagId: string): Promise<void> {
    await this.repository.remove(tenantId, tagId);
  }
}
