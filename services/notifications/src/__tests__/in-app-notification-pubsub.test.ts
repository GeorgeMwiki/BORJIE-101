/**
 * Cross-pod in-app notification fan-out — behavioural contract.
 *
 * Wires a SHARED in-memory pub/sub bus to TWO independent service
 * instances ('podA', 'podB') to emulate two server pods sharing one
 * Redis. Asserts:
 *   1. a notification created on podA reaches a WS client connected on
 *      podB (cross-pod delivery works);
 *   2. the same user's client on podA (the origin pod) receives the
 *      notification EXACTLY ONCE — the origin guard prevents the
 *      published envelope from re-pushing what podA already pushed
 *      locally;
 *   3. with NO pubsub port, a single instance still delivers locally
 *      with no throw (zero regression when REDIS_URL is unset).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createInAppNotificationService,
  type InAppNotificationService,
  type WebSocketConnection,
} from '../services/in-app-notification.service.js';
import { InMemoryNotificationPubSub } from '../services/notification-pubsub.js';
import {
  InMemoryInAppNotificationStore,
  InMemoryConnectionRegistry,
} from '../storage/in-memory.js';
import type { TenantId } from '../types/index.js';

const tenantId = 'tenant-1' as TenantId;
const userId = 'user-a';

interface CapturedClient {
  readonly connection: WebSocketConnection;
  readonly received: Array<{ type: string; data: { id: string } }>;
}

/**
 * Build a fake WS client whose `send` records every envelope. Each pod
 * gets its OWN connection id + registry, so a push only lands on the pod
 * that owns the connection — exactly like a real per-pod socket map.
 */
function makeClient(connectionId: string): CapturedClient {
  const received: Array<{ type: string; data: { id: string } }> = [];
  const connection: WebSocketConnection = {
    userId,
    tenantId,
    connectionId,
    isAlive: true,
    send: (data) => {
      received.push(data as { type: string; data: { id: string } });
    },
  };
  return { connection, received };
}

/** Let queued microtasks (the async publish/subscribe hops) settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('in-app notification cross-pod fan-out', () => {
  describe('with a shared in-memory pub/sub (two pods)', () => {
    let bus: InMemoryNotificationPubSub;
    let podA: InAppNotificationService;
    let podB: InAppNotificationService;

    beforeEach(async () => {
      // ONE bus shared by both pods — this is the "Redis" stand-in.
      bus = new InMemoryNotificationPubSub();
      podA = createInAppNotificationService({
        store: new InMemoryInAppNotificationStore(),
        connections: new InMemoryConnectionRegistry(),
        pubsub: bus,
      });
      podB = createInAppNotificationService({
        // Distinct store + registry: pods do NOT share process memory,
        // only the bus. (In production the durable store is shared too,
        // but real-time delivery must work via pub/sub regardless.)
        store: new InMemoryInAppNotificationStore(),
        connections: new InMemoryConnectionRegistry(),
        pubsub: bus,
      });
      await podA.start();
      await podB.start();
    });

    it('gives each pod a distinct, stable pod id', () => {
      expect(podA.podId).toBeTruthy();
      expect(podB.podId).toBeTruthy();
      expect(podA.podId).not.toBe(podB.podId);
    });

    it('delivers a podA-created notification to a client connected on podB', async () => {
      const clientB = makeClient('conn-b');
      // The client lives on podB → registering it subscribes podB to the
      // tenant channel.
      podB.registerConnection(clientB.connection);
      await flush();

      const created = await podA.create({
        tenantId,
        userId,
        title: 'Royalty filing due',
        message: 'Your monthly royalty return is due in 3 days',
        category: 'reminder',
        priority: 'high',
      });
      await flush();

      expect(clientB.received).toHaveLength(1);
      expect(clientB.received[0]?.type).toBe('notification');
      expect(clientB.received[0]?.data.id).toBe(created.id);
    });

    it('pushes EXACTLY ONCE to the origin pod client (no double delivery)', async () => {
      const clientA = makeClient('conn-a');
      const clientB = makeClient('conn-b');
      podA.registerConnection(clientA.connection);
      podB.registerConnection(clientB.connection);
      await flush();

      const created = await podA.create({
        tenantId,
        userId,
        title: 'Treasury sweep complete',
        message: 'TZS settlement posted to the ledger',
        category: 'payment',
      });
      await flush();

      // Origin pod: pushed once synchronously on create; the echoed
      // envelope is dropped by the origin guard → still exactly one.
      expect(clientA.received).toHaveLength(1);
      expect(clientA.received[0]?.data.id).toBe(created.id);
      // Remote pod: delivered via the bus → exactly one.
      expect(clientB.received).toHaveLength(1);
      expect(clientB.received[0]?.data.id).toBe(created.id);
    });
  });

  describe('with NO pub/sub port (single pod, REDIS_URL unset)', () => {
    let service: InAppNotificationService;

    beforeEach(() => {
      service = createInAppNotificationService({
        store: new InMemoryInAppNotificationStore(),
        connections: new InMemoryConnectionRegistry(),
        // no pubsub → legacy single-pod path
      });
    });

    it('start() resolves without throwing and is a no-op', async () => {
      await expect(service.start()).resolves.toBeUndefined();
    });

    it('still delivers locally with no throw (zero regression)', async () => {
      const client = makeClient('conn-solo');
      service.registerConnection(client.connection);

      const created = await service.create({
        tenantId,
        userId,
        title: 'Licence renewal',
        message: 'PML-0042 renews next month',
        category: 'lease',
      });
      await flush();

      expect(client.received).toHaveLength(1);
      expect(client.received[0]?.data.id).toBe(created.id);
    });
  });
});
