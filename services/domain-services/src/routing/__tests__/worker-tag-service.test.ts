/**
 * Tests for WorkerTagService (NEW 18).
 */

import { describe, it, expect, vi } from 'vitest';
import { WorkerTagService } from '../worker-tag-service.js';
import type { WorkerTag, WorkerTagRepository } from '../types.js';

function makeRepo(): WorkerTagRepository & { tags: WorkerTag[] } {
  const tags: WorkerTag[] = [];
  return {
    tags,
    async listForUser(tenantId, userId) {
      return tags.filter((t) => t.tenantId === tenantId && t.userId === userId);
    },
    async add(input) {
      const row: WorkerTag = {
        id: `wtag_${tags.length + 1}`,
        tenantId: input.tenantId,
        userId: input.userId,
        tag: input.tag,
        metadata: input.metadata ?? {},
      };
      tags.push(row);
      return row;
    },
    async remove(tenantId, id) {
      const idx = tags.findIndex(
        (t) => t.id === id && t.tenantId === tenantId
      );
      if (idx >= 0) tags.splice(idx, 1);
    },
  };
}

describe('WorkerTagService', () => {
  it('adds and lists tags per user', async () => {
    const repo = makeRepo();
    const svc = new WorkerTagService(repo);
    await svc.addTag({
      tenantId: 't1',
      userId: 'u1',
      tag: 'plumbing',
      createdBy: 'admin',
    });
    await svc.addTag({
      tenantId: 't1',
      userId: 'u1',
      tag: 'nairobi-east',
      createdBy: 'admin',
    });

    const list = await svc.listForUser('t1', 'u1');
    expect(list.map((t) => t.tag)).toEqual(['plumbing', 'nairobi-east']);
  });

  it('rejects empty tags', async () => {
    const repo = makeRepo();
    const svc = new WorkerTagService(repo);
    await expect(
      svc.addTag({
        tenantId: 't1',
        userId: 'u1',
        tag: '   ',
        createdBy: 'admin',
      })
    ).rejects.toThrow();
  });

  it('removeTag removes by id scoped by tenant', async () => {
    const repo = makeRepo();
    const svc = new WorkerTagService(repo);
    const t = await svc.addTag({
      tenantId: 't1',
      userId: 'u1',
      tag: 'x',
      createdBy: 'admin',
    });
    await svc.removeTag('t1', t.id);
    expect(repo.tags).toHaveLength(0);
  });
});
