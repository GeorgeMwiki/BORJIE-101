/**
 * BrainThreadRepository — REAL Postgres integration tests.
 *
 * Skipped when DATABASE_URL is not set. Never mocks Postgres.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import { createDatabaseClient } from '../client.js';
import { BrainThreadRepository } from '../repositories/brain-thread.repository.js';
import { tenants, users } from '../schemas/tenant.schema.js';
import { eq } from 'drizzle-orm';

const DATABASE_URL = process.env.DATABASE_URL;
const RUN = Boolean(DATABASE_URL);

describe.skipIf(!RUN)('BrainThreadRepository (real Postgres)', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let repo: BrainThreadRepository;
  const tenantId = `bt-test-${uuid()}`;
  const userId = `bt-user-${uuid()}`;

  beforeAll(async () => {
    db = createDatabaseClient(DATABASE_URL!);
    repo = new BrainThreadRepository(db);
    await db.insert(tenants).values({
      id: tenantId,
      name: 'Brain Thread Test',
      slug: tenantId,
      status: 'active',
      subscriptionTier: 'starter',
      primaryEmail: 'bt@example.com',
    });
    await db.insert(users).values({
      id: userId,
      tenantId,
      email: 'btuser@example.com',
      passwordHash: 'x',
      firstName: 'BT',
      lastName: 'User',
      status: 'active',
    } as never);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  it('creates, lists, and reads thread events', async () => {
    const threadId = uuid();
    await repo.createThread({
      id: threadId,
      tenantId,
      initiatingUserId: userId,
      primaryPersonaId: 'estate-manager',
      title: 'integration test',
      status: 'open',
    });

    await repo.appendEvent(tenantId, {
      id: uuid(),
      threadId,
      kind: 'user_message',
      actorId: userId,
      visibility: {
        scope: 'management',
        authorActorId: userId,
        initiatingUserId: userId,
      },
      createdAt: new Date().toISOString(),
      text: 'hello',
    } as never);

    const events = await repo.listEvents(threadId);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('user_message');

    const list = await repo.listThreads(tenantId, { userId });
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].id).toBe(threadId);
  });

  it('archives threads', async () => {
    const threadId = uuid();
    await repo.createThread({
      id: threadId,
      tenantId,
      initiatingUserId: userId,
      primaryPersonaId: 'estate-manager',
      title: 'to-archive',
      status: 'open',
    });
    await repo.archiveThread(threadId);
    const t = await repo.getThread(threadId);
    expect(t?.status).toBe('archived');
  });
});
