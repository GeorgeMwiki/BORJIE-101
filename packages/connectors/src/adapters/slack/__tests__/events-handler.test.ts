/**
 * Slack events-handler — end-to-end tests for the front-door.
 *
 * Covers:
 *   - url_verification challenge response.
 *   - Signature-verify failure → 401 rejected.
 *   - Valid signed callback → emitter called, accepted outcome.
 *   - Cross-tenant team_id → 400 rejected.
 *   - Unknown inner event type → accepted but zero events.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createSlackAclResolver } from '../acl-resolver.js';
import { createSlackBrainEventEmitter } from '../brain-event-emitter.js';
import { createSlackEventsHandler } from '../events-handler.js';
import type { SlackClient } from '../slack-client.js';
import type {
  BrainEvent,
  BrainEventPublisher,
  SlackTenantInstall,
} from '../types.js';

const TENANT_ID = 'tenant_alpha';
const TEAM_ID = 'T0WORK001';
const SIGNING_SECRET = 'slack-signing-test-secret';

function makeInstall(): SlackTenantInstall {
  return {
    tenantId: TENANT_ID,
    teamId: TEAM_ID,
    botToken: 'xoxb-x',
    signingSecret: SIGNING_SECRET,
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
      data: { ok: true, members: ['U1', 'U2'], response_metadata: { next_cursor: '' } },
      latencyMs: 1,
      attempt: 1,
    }),
    chatPostMessage: vi.fn(),
    usersInfo: vi.fn(),
    oauthV2Access: vi.fn(),
  } as unknown as SlackClient;
}

function makeCapturingPublisher(): BrainEventPublisher & { readonly events: BrainEvent[] } {
  const events: BrainEvent[] = [];
  return {
    events,
    publish: vi.fn(async (event: BrainEvent) => {
      events.push(event);
    }),
  };
}

function signBody(body: string, timestampSec: number): { signature: string; timestamp: string } {
  const ts = String(timestampSec);
  const hex = createHmac('sha256', SIGNING_SECRET)
    .update(`v0:${ts}:${body}`, 'utf8')
    .digest('hex');
  return { signature: `v0=${hex}`, timestamp: ts };
}

function buildHandler() {
  const install = makeInstall();
  const client = makeStubClient(install);
  const aclResolver = createSlackAclResolver({ client, tenantId: TENANT_ID });
  const publisher = makeCapturingPublisher();
  const emitter = createSlackBrainEventEmitter({
    install,
    publisher,
    aclResolver,
  });
  const handler = createSlackEventsHandler({
    install,
    emitter,
    nowSeconds: () => 1_700_000_000,
  });
  return { handler, publisher };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('SlackEventsHandler — url_verification', () => {
  it('returns the challenge for a correctly signed handshake', async () => {
    const { handler } = buildHandler();
    const body = JSON.stringify({
      type: 'url_verification',
      token: 'tok',
      challenge: 'abc123challenge',
    });
    const sig = signBody(body, 1_700_000_000);

    const outcome = await handler.handle(body, {
      'x-slack-signature': sig.signature,
      'x-slack-request-timestamp': sig.timestamp,
    });

    expect(outcome).toEqual({ kind: 'challenge', challenge: 'abc123challenge' });
  });
});

describe('SlackEventsHandler — signature failure', () => {
  it('returns 401 rejected when the signature is invalid', async () => {
    const { handler } = buildHandler();
    const body = JSON.stringify({
      type: 'url_verification',
      token: 'tok',
      challenge: 'xyz',
    });

    const outcome = await handler.handle(body, {
      'x-slack-signature': 'v0=' + 'a'.repeat(64),
      'x-slack-request-timestamp': '1700000000',
    });

    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') {
      expect(outcome.status).toBe(401);
    }
  });
});

describe('SlackEventsHandler — event_callback dispatch', () => {
  it('accepts a valid message callback and the emitter publishes', async () => {
    const { handler, publisher } = buildHandler();
    const body = JSON.stringify({
      type: 'event_callback',
      team_id: TEAM_ID,
      api_app_id: 'A0APP',
      event_id: 'Ev01',
      event_time: 1_700_000_000,
      event: {
        type: 'message',
        channel: 'D1',
        user: 'U_SENDER',
        ts: '1700000000.000100',
        channel_type: 'im',
        text: 'send the receipt before I approve',
      },
    });
    const sig = signBody(body, 1_700_000_000);

    const outcome = await handler.handle(body, {
      'x-slack-signature': sig.signature,
      'x-slack-request-timestamp': sig.timestamp,
    });

    expect(outcome.kind).toBe('accepted');
    if (outcome.kind === 'accepted') {
      expect(outcome.publishedEvents).toBe(1);
    }
    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]!.type).toBe('comms.slack.inbound');
  });

  it('rejects 400 on cross-tenant team_id', async () => {
    const { handler, publisher } = buildHandler();
    const body = JSON.stringify({
      type: 'event_callback',
      team_id: 'T_OTHER',
      api_app_id: 'A0APP',
      event_id: 'Ev01',
      event_time: 1_700_000_000,
      event: {
        type: 'message',
        channel: 'D1',
        user: 'U_SENDER',
        ts: '1700000000.000100',
        channel_type: 'im',
        text: 'hi',
      },
    });
    const sig = signBody(body, 1_700_000_000);

    const outcome = await handler.handle(body, {
      'x-slack-signature': sig.signature,
      'x-slack-request-timestamp': sig.timestamp,
    });

    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') {
      expect(outcome.status).toBe(400);
      expect(outcome.reason).toBe('tenant-mismatch');
    }
    expect(publisher.events).toHaveLength(0);
  });

  it('accepts unknown inner event types without publishing', async () => {
    const { handler, publisher } = buildHandler();
    const body = JSON.stringify({
      type: 'event_callback',
      team_id: TEAM_ID,
      api_app_id: 'A0APP',
      event_id: 'Ev01',
      event_time: 1_700_000_000,
      event: { type: 'team_join' /* unsubscribed */, user: 'U1' },
    });
    const sig = signBody(body, 1_700_000_000);

    const outcome = await handler.handle(body, {
      'x-slack-signature': sig.signature,
      'x-slack-request-timestamp': sig.timestamp,
    });

    expect(outcome.kind).toBe('accepted');
    if (outcome.kind === 'accepted') {
      expect(outcome.publishedEvents).toBe(0);
    }
    expect(publisher.events).toHaveLength(0);
  });
});

describe('SlackEventsHandler — malformed input', () => {
  it('rejects 400 on malformed JSON', async () => {
    const { handler } = buildHandler();
    const body = 'not-valid-json{';
    const sig = signBody(body, 1_700_000_000);

    const outcome = await handler.handle(body, {
      'x-slack-signature': sig.signature,
      'x-slack-request-timestamp': sig.timestamp,
    });

    expect(outcome).toEqual({ kind: 'rejected', status: 400, reason: 'malformed-json' });
  });
});
