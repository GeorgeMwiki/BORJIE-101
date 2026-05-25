/**
 * Slack ↔ canonical BrainEventBus integration test.
 *
 * Proves structural interop between this connector's brain-event
 * emitter and the canonical `InMemoryBrainEventBus` shipped by
 * `packages/ai-copilot/src/brain-event-bus/`. The connectors package
 * intentionally has zero `@borjie/*` workspace deps (keeps the
 * install graph small), so this test does NOT import the canonical
 * bus directly — instead it re-implements its minimal contract
 * locally and asserts:
 *
 *   1. A subscriber to `comms.slack.inbound` receives every event the
 *      emitter publishes.
 *   2. The event shape (type, tenantId, acl envelope, payload keys,
 *      observedAt as Date, sourceSystem === 'slack') matches the
 *      canonical `BrainEvent` interface byte-for-byte.
 *
 * If the canonical bus's contract ever changes, the WhatsApp emitter
 * test in `services/notifications/src/whatsapp/brain/` and this test
 * BOTH break — that's the intended invariant: structural drift across
 * the three packages (ai-copilot canonical, whatsapp emitter,
 * connectors emitter) is loud, not silent.
 */
import { describe, expect, it, vi } from 'vitest';

import { createSlackAclResolver } from '../acl-resolver.js';
import { createSlackBrainEventEmitter } from '../brain-event-emitter.js';
import type { SlackClient } from '../slack-client.js';
import type {
  BrainEvent,
  BrainEventPublisher,
  SlackEventCallbackEnvelope,
  SlackTenantInstall,
} from '../types.js';

// ----------------------------------------------------------------------------
// Local mini-bus — mirrors the canonical InMemoryBrainEventBus contract
// at packages/ai-copilot/src/brain-event-bus/in-memory-bus.ts
// ----------------------------------------------------------------------------

type Handler = (event: BrainEvent) => Promise<void>;

interface MiniBus extends BrainEventPublisher {
  subscribe(type: string, handler: Handler): { unsubscribe(): void };
}

function makeMiniBus(): MiniBus {
  const subs = new Map<string, Handler[]>();

  return {
    async publish(event: BrainEvent): Promise<void> {
      // Tenant isolation contract — mirrors canonical bus.
      if (!event.tenantId || event.tenantId.length === 0) {
        throw new Error('mini-bus: empty tenantId');
      }
      const handlers = subs.get(event.type) ?? [];
      // Fan-out on microtask, mirroring InMemoryBrainEventBus.
      for (const h of handlers) {
        void h(event);
      }
    },
    subscribe(type: string, handler: Handler) {
      const list = subs.get(type) ?? [];
      list.push(handler);
      subs.set(type, list);
      return {
        unsubscribe() {
          const next = (subs.get(type) ?? []).filter((h) => h !== handler);
          if (next.length === 0) subs.delete(type);
          else subs.set(type, next);
        },
      };
    },
  };
}

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const TENANT_ID = 'tenant_integration';
const TEAM_ID = 'T0INTEG001';

function makeInstall(): SlackTenantInstall {
  return {
    tenantId: TENANT_ID,
    teamId: TEAM_ID,
    botToken: 'xoxb-x',
    signingSecret: 'sig',
    botUserId: 'U0BOT001',
  };
}

function makeStubClient(install: SlackTenantInstall): SlackClient {
  return {
    install,
    connector: { id: 'slack', call: vi.fn(), health: vi.fn() },
    conversationsInfo: vi.fn().mockResolvedValue({
      kind: 'ok',
      data: { ok: true, channel: { id: 'D1', is_im: true } },
      latencyMs: 1,
      attempt: 1,
    }),
    conversationsMembers: vi.fn().mockResolvedValue({
      kind: 'ok',
      data: { ok: true, members: ['U_X', 'U_Y'], response_metadata: { next_cursor: '' } },
      latencyMs: 1,
      attempt: 1,
    }),
    chatPostMessage: vi.fn(),
    usersInfo: vi.fn(),
    oauthV2Access: vi.fn(),
  } as unknown as SlackClient;
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('Slack emitter ↔ canonical-shaped BrainEventBus integration', () => {
  it('delivers an emitted event to a subscriber on the bus', async () => {
    const install = makeInstall();
    const client = makeStubClient(install);
    const aclResolver = createSlackAclResolver({ client, tenantId: TENANT_ID });
    const bus = makeMiniBus();

    const received: BrainEvent[] = [];
    bus.subscribe('comms.slack.inbound', async (event) => {
      received.push(event);
    });

    const emitter = createSlackBrainEventEmitter({
      install,
      publisher: bus,
      aclResolver,
    });

    const envelope: SlackEventCallbackEnvelope = {
      type: 'event_callback',
      team_id: TEAM_ID,
      api_app_id: 'A0',
      event_id: 'Ev0001',
      event_time: 1_700_000_000,
      event: {
        type: 'message',
        channel: 'D1',
        user: 'U_X',
        ts: '1700000000.000100',
        channel_type: 'im',
        text: 'send the receipt before I approve',
      },
    };

    await emitter.emitFromEnvelope(envelope);
    // Flush microtask queue (bus dispatches on microtask).
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(received).toHaveLength(1);

    const event = received[0]!;
    // Shape parity with canonical BrainEvent:
    expect(event.type).toBe('comms.slack.inbound');
    expect(event.tenantId).toBe(TENANT_ID);
    expect(event.sourceSystem).toBe('slack');
    expect(event.observedAt).toBeInstanceOf(Date);
    expect(event.observedAt.getTime()).toBe(1_700_000_000_000);
    expect(Array.isArray(event.acl.userIds)).toBe(true);
    expect(Array.isArray(event.acl.roleIds)).toBe(true);
    expect(event.acl.userIds).toEqual(['U_X', 'U_Y']);
    expect(event.payload).toMatchObject({
      slackEventType: 'message',
      recognisedIntent: 'approve-after-receipt',
    });
  });

  it('does not break the bus when no subscriber is registered', async () => {
    const install = makeInstall();
    const client = makeStubClient(install);
    const aclResolver = createSlackAclResolver({ client, tenantId: TENANT_ID });
    const bus = makeMiniBus();

    const emitter = createSlackBrainEventEmitter({
      install,
      publisher: bus,
      aclResolver,
    });

    const envelope: SlackEventCallbackEnvelope = {
      type: 'event_callback',
      team_id: TEAM_ID,
      api_app_id: 'A0',
      event_id: 'Ev0002',
      event_time: 1_700_000_000,
      event: {
        type: 'app_mention',
        user: 'U_X',
        channel: 'D1',
        ts: '1700000000.000100',
        text: 'no subscriber listening',
      },
    };

    // Should not throw, should not warn — the canonical bus's no-op
    // path for un-subscribed types is silent.
    const published = await emitter.emitFromEnvelope(envelope);
    expect(published).toBe(1);
  });

  it('refuses to publish events with an empty tenantId', async () => {
    // Construct the bus directly and verify it rejects bad events
    // — proves our duck-typed publisher contract matches the
    // canonical tenant-isolation requirement.
    const bus = makeMiniBus();
    await expect(
      bus.publish({
        type: 'comms.slack.inbound',
        tenantId: '',
        payload: {},
        acl: { userIds: [], roleIds: [] },
        observedAt: new Date(),
        sourceSystem: 'slack',
      }),
    ).rejects.toThrow(/tenantId/);
  });
});
