/**
 * In-app notification service — behavioural contract.
 *
 * Round-3 audit H7 — both `InMemoryInAppNotificationStore` and
 * `RedisInAppNotificationStore` MUST satisfy the same contract.
 * `describe.each` runs every assertion against both adapters.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createInAppNotificationService,
  type InAppNotificationService,
} from '../services/in-app-notification.service.js';
import {
  InMemoryInAppNotificationStore,
  InMemoryConnectionRegistry,
} from '../storage/in-memory.js';
import { RedisInAppNotificationStore } from '../storage/redis.js';
import { createIoredisMock } from './helpers/ioredis-mock.js';
import type { TenantId } from '../types/index.js';

type Factory = () => InAppNotificationService;

const ADAPTERS: ReadonlyArray<[string, Factory]> = [
  [
    'InMemory',
    () =>
      createInAppNotificationService({
        store: new InMemoryInAppNotificationStore(),
        connections: new InMemoryConnectionRegistry(),
      }),
  ],
  [
    'Redis',
    () => {
      const client = createIoredisMock();
      return createInAppNotificationService({
        store: new RedisInAppNotificationStore(client as never),
        connections: new InMemoryConnectionRegistry(),
      });
    },
  ],
];

describe.each(ADAPTERS)(
  'inAppNotificationService [%s]',
  (_label, factory) => {
    const tenantId = 'tenant-1' as TenantId;
    const userId = 'user-a';
    let service: InAppNotificationService;

    beforeEach(() => {
      service = factory();
    });

    it('persists a created notification + lists it for the user', async () => {
      const created = await service.create({
        tenantId,
        userId,
        title: 'Rent due',
        message: 'Your rent is due tomorrow',
        category: 'payment',
        priority: 'high',
      });
      expect(created.id).toBeTruthy();
      expect(created.isRead).toBe(false);

      const { notifications: rows, total } = await service.listForUser(
        tenantId,
        userId
      );
      expect(total).toBe(1);
      expect(rows[0]?.id).toBe(created.id);
    });

    it('respects tenant + user scoping on getById', async () => {
      const created = await service.create({
        tenantId,
        userId,
        title: 't',
        message: 'm',
        category: 'system',
      });
      // Same id under a different user → null
      expect(
        await service.getById(created.id, tenantId, 'someone-else')
      ).toBeNull();
      // Same id under a different tenant → null
      expect(
        await service.getById(
          created.id,
          'tenant-other' as TenantId,
          userId
        )
      ).toBeNull();
      // Right pair → the row
      expect((await service.getById(created.id, tenantId, userId))?.id).toBe(
        created.id
      );
    });

    it('markAllAsRead walks every unread row, not just the first 1000', async () => {
      // Round-3 audit H10 regression — write 1,100 rows and ensure
      // every one is marked read.
      for (let i = 0; i < 1100; i++) {
        await service.create({
          tenantId,
          userId,
          title: `n-${i}`,
          message: 'm',
          category: 'system',
        });
      }
      const count = await service.markAllAsRead(tenantId, userId);
      expect(count).toBe(1100);
      const { notifications: stillUnread } = await service.listForUser(
        tenantId,
        userId,
        { isRead: false },
        2000,
        0
      );
      expect(stillUnread).toHaveLength(0);
    });

    it('createAnnouncement fans out to every supplied user id', async () => {
      // Round-3 audit C5 — announcements MUST resolve to real users
      // (no `userId: '*'` sentinel).
      const result = await service.createAnnouncement(
        tenantId,
        'System maintenance',
        'We will be down at 02:00 UTC',
        ['u1', 'u2', 'u3']
      );
      expect(result.sent).toBe(3);
      expect(result.failed).toBe(0);
      const { total } = await service.listForUser(tenantId, 'u2');
      expect(total).toBe(1);
    });
  }
);
