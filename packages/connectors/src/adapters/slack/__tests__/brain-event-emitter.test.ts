/**
 * Slack brain-event emitter — emit + ACL integration tests.
 *
 * Proves the canonical contract from the task scope:
 *   - DM events carry `acl.userIds = [sender, recipient]`.
 *   - Channel events carry `acl.userIds = [all members]`.
 *   - Public-channel events carry `acl.roleIds = [tenantAllMembersRoleId]`.
 *   - Tenant isolation — cross-tenant envelopes are dropped.
 *   - Bot-self events (`bot_id` set, or `user === botUserId`) skipped.
 *   - Emitted events include the recognised intent from the miner.
 *
 * Uses an in-memory publisher stub to capture every emitted event,
 * plus stub ACL resolver + user resolver so the test runs without
 * any HTTP IO.
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
  SlackUserResolver,
} from '../types.js';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const TENANT_ID = 'tenant_alpha';
const TEAM_ID = 'T0WORK001';
const ALL_MEMBERS_ROLE = 'role_tenant_alpha_all_members';

function makeInstall(overrides: Partial<SlackTenantInstall> = {}): SlackTenantInstall {
  return {
    tenantId: TENANT_ID,
    teamId: TEAM_ID,
    botToken: 'xoxb-test',
    signingSecret: 'sig-secret',
    botUserId: 'U0BOT001',
    tokenType: 'bot',
    ...overrides,
  };
}

interface CapturingPublisher extends BrainEventPublisher {
  readonly events: BrainEvent[];
}

function makeCapturingPublisher(): CapturingPublisher {
  const events: BrainEvent[] = [];
  return {
    events,
    publish: vi.fn(async (event: BrainEvent) => {
      events.push(event);
    }),
  };
}

function makeStubClient(stub: {
  channelKind: 'im' | 'mpim' | 'group' | 'channel';
  members: ReadonlyArray<string>;
  install?: SlackTenantInstall;
}): SlackClient {
  const channel = (() => {
    switch (stub.channelKind) {
      case 'im':
        return { id: 'D1', is_im: true };
      case 'mpim':
        return { id: 'D2', is_mpim: true };
      case 'group':
        return { id: 'G1', is_group: true, is_private: true };
      case 'channel':
        return { id: 'C1', is_channel: true, is_private: false };
    }
  })();

  return {
    install: stub.install ?? makeInstall(),
    connector: { id: `slack:${TEAM_ID}`, call: vi.fn(), health: vi.fn() },
    conversationsInfo: vi.fn().mockResolvedValue({
      kind: 'ok',
      data: { ok: true, channel },
      latencyMs: 1,
      attempt: 1,
    }),
    conversationsMembers: vi.fn().mockResolvedValue({
      kind: 'ok',
      data: { ok: true, members: stub.members, response_metadata: { next_cursor: '' } },
      latencyMs: 1,
      attempt: 1,
    }),
    chatPostMessage: vi.fn(),
    usersInfo: vi.fn(),
    oauthV2Access: vi.fn(),
  } as unknown as SlackClient;
}

function makeMessageEnvelope(overrides: {
  channel: string;
  channelType: 'channel' | 'group' | 'im' | 'mpim';
  user?: string;
  text?: string;
  bot_id?: string;
  team_id?: string;
}): SlackEventCallbackEnvelope {
  return {
    type: 'event_callback',
    team_id: overrides.team_id ?? TEAM_ID,
    api_app_id: 'A0APP001',
    event_id: 'Ev0001',
    event_time: 1_700_000_000,
    event: {
      type: 'message',
      channel: overrides.channel,
      ...(overrides.user !== undefined ? { user: overrides.user } : {}),
      ...(overrides.text !== undefined ? { text: overrides.text } : {}),
      ts: '1700000000.000100',
      channel_type: overrides.channelType,
      ...(overrides.bot_id !== undefined ? { bot_id: overrides.bot_id } : {}),
    },
  };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('SlackBrainEventEmitter — DM emits with [sender, recipient] ACL', () => {
  it('captures sender + recipient as userIds and no roleIds', async () => {
    const install = makeInstall();
    const client = makeStubClient({
      channelKind: 'im',
      members: ['U_SENDER', 'U_BOT_RECIP'],
      install,
    });
    const aclResolver = createSlackAclResolver({
      client,
      tenantId: TENANT_ID,
    });
    const publisher = makeCapturingPublisher();
    const emitter = createSlackBrainEventEmitter({
      install,
      publisher,
      aclResolver,
    });

    const published = await emitter.emitFromEnvelope(
      makeMessageEnvelope({
        channel: 'D1',
        channelType: 'im',
        user: 'U_SENDER',
        text: 'send the receipt before I approve',
      }),
    );

    expect(published).toBe(1);
    expect(publisher.events).toHaveLength(1);

    const event = publisher.events[0]!;
    expect(event.type).toBe('comms.slack.inbound');
    expect(event.tenantId).toBe(TENANT_ID);
    expect(event.sourceSystem).toBe('slack');
    // DM ACL: both members of the DM, no roles.
    expect(event.acl.userIds).toEqual(['U_SENDER', 'U_BOT_RECIP']);
    expect(event.acl.roleIds).toEqual([]);
    // Actor resolved via synthetic fallback (no userResolver wired).
    expect(event.actorId).toBe(`slack:${TEAM_ID}:U_SENDER`);
    // Mined intent rides on the payload.
    expect(event.payload).toMatchObject({
      slackEventType: 'message',
      channelType: 'im',
      recognisedIntent: 'approve-after-receipt',
      intentConfidence: 1,
      intentChiSquared: 18.4,
    });
  });
});

describe('SlackBrainEventEmitter — private channel emits with full-member ACL', () => {
  it('captures all members as userIds with empty roleIds', async () => {
    const install = makeInstall();
    const client = makeStubClient({
      channelKind: 'group',
      members: ['U1', 'U2', 'U3', 'U_SENDER'],
      install,
    });
    const aclResolver = createSlackAclResolver({
      client,
      tenantId: TENANT_ID,
    });
    const publisher = makeCapturingPublisher();
    const emitter = createSlackBrainEventEmitter({
      install,
      publisher,
      aclResolver,
    });

    await emitter.emitFromEnvelope(
      makeMessageEnvelope({
        channel: 'G1',
        channelType: 'group',
        user: 'U_SENDER',
        text: 'just an FYI',
      }),
    );

    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]!.acl.userIds).toEqual([
      'U1',
      'U2',
      'U3',
      'U_SENDER',
    ]);
    expect(publisher.events[0]!.acl.roleIds).toEqual([]);
  });
});

describe('SlackBrainEventEmitter — public channel emits with role-based ACL', () => {
  it('captures empty userIds and the tenant all-members role', async () => {
    const install = makeInstall();
    const client = makeStubClient({
      channelKind: 'channel',
      members: ['U1', 'U2'],
      install,
    });
    const aclResolver = createSlackAclResolver({
      client,
      tenantId: TENANT_ID,
      tenantAllMembersRoleId: ALL_MEMBERS_ROLE,
    });
    const publisher = makeCapturingPublisher();
    const emitter = createSlackBrainEventEmitter({
      install,
      publisher,
      aclResolver,
    });

    await emitter.emitFromEnvelope(
      makeMessageEnvelope({
        channel: 'C1',
        channelType: 'channel',
        user: 'U_SENDER',
        text: 'morning team',
      }),
    );

    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]!.acl.userIds).toEqual([]);
    expect(publisher.events[0]!.acl.roleIds).toEqual([ALL_MEMBERS_ROLE]);
  });
});

describe('SlackBrainEventEmitter — tenant isolation', () => {
  it('drops envelopes with a mismatched team_id', async () => {
    const install = makeInstall();
    const client = makeStubClient({
      channelKind: 'im',
      members: ['U1', 'U2'],
      install,
    });
    const aclResolver = createSlackAclResolver({
      client,
      tenantId: TENANT_ID,
    });
    const publisher = makeCapturingPublisher();
    const logger = { warn: vi.fn() };
    const emitter = createSlackBrainEventEmitter({
      install,
      publisher,
      aclResolver,
      logger,
    });

    const published = await emitter.emitFromEnvelope(
      makeMessageEnvelope({
        channel: 'D1',
        channelType: 'im',
        user: 'U_SENDER',
        team_id: 'T_DIFFERENT',
      }),
    );

    expect(published).toBe(0);
    expect(publisher.events).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

describe('SlackBrainEventEmitter — bot self-suppression', () => {
  it('skips messages emitted by the bot itself (bot_id set)', async () => {
    const install = makeInstall();
    const client = makeStubClient({
      channelKind: 'im',
      members: ['U_USER', 'U0BOT001'],
      install,
    });
    const aclResolver = createSlackAclResolver({ client, tenantId: TENANT_ID });
    const publisher = makeCapturingPublisher();
    const emitter = createSlackBrainEventEmitter({
      install,
      publisher,
      aclResolver,
    });

    const published = await emitter.emitFromEnvelope(
      makeMessageEnvelope({
        channel: 'D1',
        channelType: 'im',
        bot_id: 'B0BOT001',
        text: 'I am a bot reply',
      }),
    );

    expect(published).toBe(0);
    expect(publisher.events).toHaveLength(0);
  });

  it("skips messages where user === bot's user id", async () => {
    const install = makeInstall({ botUserId: 'U_BOT_SELF' });
    const client = makeStubClient({
      channelKind: 'im',
      members: ['U_USER', 'U_BOT_SELF'],
      install,
    });
    const aclResolver = createSlackAclResolver({ client, tenantId: TENANT_ID });
    const publisher = makeCapturingPublisher();
    const emitter = createSlackBrainEventEmitter({
      install,
      publisher,
      aclResolver,
    });

    const published = await emitter.emitFromEnvelope(
      makeMessageEnvelope({
        channel: 'D1',
        channelType: 'im',
        user: 'U_BOT_SELF',
        text: 'echo',
      }),
    );

    expect(published).toBe(0);
  });
});

describe('SlackBrainEventEmitter — user resolver wiring', () => {
  it('uses the userResolver to map slack uid → platform uid', async () => {
    const install = makeInstall();
    const client = makeStubClient({
      channelKind: 'im',
      members: ['U_SENDER', 'U_BOT_RECIP'],
      install,
    });
    const aclResolver = createSlackAclResolver({ client, tenantId: TENANT_ID });
    const publisher = makeCapturingPublisher();
    const userResolver: SlackUserResolver = {
      resolveUserId: vi.fn().mockResolvedValue('user_platform_42'),
    };

    const emitter = createSlackBrainEventEmitter({
      install,
      publisher,
      aclResolver,
      userResolver,
    });

    await emitter.emitFromEnvelope(
      makeMessageEnvelope({
        channel: 'D1',
        channelType: 'im',
        user: 'U_SENDER',
        text: 'hello',
      }),
    );

    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]!.actorId).toBe('user_platform_42');
    expect(userResolver.resolveUserId).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      slackUserId: 'U_SENDER',
    });
  });
});

describe('SlackBrainEventEmitter — reaction + app_mention events', () => {
  it('emits a brain event for a reaction_added on a message', async () => {
    const install = makeInstall();
    const client = makeStubClient({
      channelKind: 'group',
      members: ['U1', 'U2'],
      install,
    });
    const aclResolver = createSlackAclResolver({ client, tenantId: TENANT_ID });
    const publisher = makeCapturingPublisher();
    const emitter = createSlackBrainEventEmitter({
      install,
      publisher,
      aclResolver,
    });

    const envelope: SlackEventCallbackEnvelope = {
      type: 'event_callback',
      team_id: TEAM_ID,
      api_app_id: 'A0APP',
      event_id: 'Ev0002',
      event_time: 1_700_000_010,
      event: {
        type: 'reaction_added',
        user: 'U1',
        reaction: 'white_check_mark',
        item_user: 'U2',
        item: {
          type: 'message',
          channel: 'G1',
          ts: '1700000000.000100',
        },
        event_ts: '1700000010.000001',
      },
    };

    const published = await emitter.emitFromEnvelope(envelope);
    expect(published).toBe(1);
    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]!.payload).toMatchObject({
      slackEventType: 'reaction_added',
      reaction: 'white_check_mark',
      targetTs: '1700000000.000100',
    });
    // subjectId is set to "channel:ts" so consumers can join to the
    // original message.
    expect(publisher.events[0]!.subjectId).toBe('G1:1700000000.000100');
  });

  it('emits a brain event for an app_mention', async () => {
    const install = makeInstall();
    const client = makeStubClient({
      channelKind: 'channel',
      members: [],
      install,
    });
    const aclResolver = createSlackAclResolver({
      client,
      tenantId: TENANT_ID,
      tenantAllMembersRoleId: ALL_MEMBERS_ROLE,
    });
    const publisher = makeCapturingPublisher();
    const emitter = createSlackBrainEventEmitter({
      install,
      publisher,
      aclResolver,
    });

    const envelope: SlackEventCallbackEnvelope = {
      type: 'event_callback',
      team_id: TEAM_ID,
      api_app_id: 'A0APP',
      event_id: 'Ev0003',
      event_time: 1_700_000_020,
      event: {
        type: 'app_mention',
        user: 'U_USER',
        channel: 'C1',
        ts: '1700000020.000200',
        text: '<@U0BOT001> approve once we have the receipt',
      },
    };

    await emitter.emitFromEnvelope(envelope);
    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]!.payload).toMatchObject({
      slackEventType: 'app_mention',
      recognisedIntent: 'approve-after-receipt',
    });
    expect(publisher.events[0]!.acl.roleIds).toEqual([ALL_MEMBERS_ROLE]);
  });
});
