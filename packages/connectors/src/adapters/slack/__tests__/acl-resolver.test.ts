/**
 * Slack ACL resolver — unit tests.
 *
 * Covers the channel-kind discrimination rule from the task scope:
 * "DM = sender+receiver; channel = all members" plus the v1
 * extensions for multi-person DM, private channel, and public
 * channel (tenant-wide role-based read).
 *
 * The resolver delegates to a `SlackClient`; we stub the client's
 * `conversationsInfo` and `conversationsMembers` directly so the
 * tests don't have to spin up an HTTP mock.
 */
import { describe, expect, it, vi } from 'vitest';

import { createSlackAclResolver } from '../acl-resolver.js';
import type { SlackClient } from '../slack-client.js';
import type { SlackTenantInstall } from '../types.js';

// ----------------------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------------------

const TENANT_ID = 'tenant_alpha';
const ALL_MEMBERS_ROLE = 'role_tenant_alpha_all_members';

function makeInstall(): SlackTenantInstall {
  return {
    tenantId: TENANT_ID,
    teamId: 'T0WORK001',
    botToken: 'xoxb-bot-token',
    signingSecret: 'sig-secret',
    botUserId: 'U0BOT001',
    tokenType: 'bot',
  };
}

function makeStubClient(overrides: {
  info: { kind: 'im' | 'mpim' | 'group' | 'channel' };
  members?: ReadonlyArray<string>;
  membersPagedExtra?: ReadonlyArray<string>;
}): SlackClient {
  const infoChannel = (() => {
    const k = overrides.info.kind;
    if (k === 'im') return { id: 'D1', is_im: true };
    if (k === 'mpim') return { id: 'D2', is_mpim: true };
    if (k === 'group') return { id: 'G1', is_group: true, is_private: true };
    return { id: 'C1', is_channel: true, is_private: false };
  })();

  const members = overrides.members ?? [];
  const extra = overrides.membersPagedExtra ?? [];

  // First call returns `cursor: 'page2'` if there's an extra page;
  // second call returns `cursor: ''` to terminate the loop.
  let callCount = 0;
  const conversationsMembers = vi.fn().mockImplementation(async () => {
    callCount += 1;
    if (callCount === 1) {
      return {
        kind: 'ok',
        data: {
          ok: true,
          members,
          response_metadata: extra.length > 0 ? { next_cursor: 'page2' } : { next_cursor: '' },
        },
        latencyMs: 1,
        attempt: 1,
      };
    }
    return {
      kind: 'ok',
      data: {
        ok: true,
        members: extra,
        response_metadata: { next_cursor: '' },
      },
      latencyMs: 1,
      attempt: 1,
    };
  });

  const conversationsInfo = vi.fn().mockResolvedValue({
    kind: 'ok',
    data: { ok: true, channel: infoChannel },
    latencyMs: 1,
    attempt: 1,
  });

  // Minimal SlackClient surface used by the resolver. Other methods
  // are never called; we cast to satisfy the structural type.
  const client = {
    install: makeInstall(),
    connector: { id: 'slack:T0WORK001', call: vi.fn(), health: vi.fn() },
    conversationsInfo,
    conversationsMembers,
    chatPostMessage: vi.fn(),
    usersInfo: vi.fn(),
    oauthV2Access: vi.fn(),
  };

  return client as unknown as SlackClient;
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('SlackAclResolver — DM (im)', () => {
  it('returns sender + recipient as the member list', async () => {
    const client = makeStubClient({
      info: { kind: 'im' },
      members: ['U_SENDER', 'U_RECIPIENT'],
    });
    const resolver = createSlackAclResolver({
      client,
      tenantId: TENANT_ID,
      tenantAllMembersRoleId: ALL_MEMBERS_ROLE,
    });

    const acl = await resolver.resolve({ tenantId: TENANT_ID, channelId: 'D1' });

    expect(acl).toEqual({
      kind: 'im',
      members: ['U_SENDER', 'U_RECIPIENT'],
      isPublic: false,
    });
  });
});

describe('SlackAclResolver — private channel (group)', () => {
  it('returns the full member list paginated across pages', async () => {
    const client = makeStubClient({
      info: { kind: 'group' },
      members: ['U1', 'U2'],
      membersPagedExtra: ['U3', 'U4'],
    });
    const resolver = createSlackAclResolver({
      client,
      tenantId: TENANT_ID,
      tenantAllMembersRoleId: ALL_MEMBERS_ROLE,
    });

    const acl = await resolver.resolve({ tenantId: TENANT_ID, channelId: 'G1' });

    expect(acl.kind).toBe('group');
    expect(acl.isPublic).toBe(false);
    expect(acl.members).toEqual(['U1', 'U2', 'U3', 'U4']);
  });

  it('dedupes member ids across pages', async () => {
    const client = makeStubClient({
      info: { kind: 'group' },
      members: ['U1', 'U2'],
      membersPagedExtra: ['U2', 'U3'],
    });
    const resolver = createSlackAclResolver({
      client,
      tenantId: TENANT_ID,
    });

    const acl = await resolver.resolve({ tenantId: TENANT_ID, channelId: 'G1' });

    expect(acl.members).toEqual(['U1', 'U2', 'U3']);
  });
});

describe('SlackAclResolver — public channel', () => {
  it('returns isPublic=true with empty members (role-based read)', async () => {
    const client = makeStubClient({
      info: { kind: 'channel' },
      members: ['U1', 'U2'],
    });
    const resolver = createSlackAclResolver({
      client,
      tenantId: TENANT_ID,
      tenantAllMembersRoleId: ALL_MEMBERS_ROLE,
    });

    const acl = await resolver.resolve({ tenantId: TENANT_ID, channelId: 'C1' });

    expect(acl.isPublic).toBe(true);
    expect(acl.kind).toBe('channel');
    expect(acl.members).toEqual([]);
    expect(resolver.getTenantAllMembersRoleId()).toBe(ALL_MEMBERS_ROLE);
  });
});

describe('SlackAclResolver — multi-person DM (mpim)', () => {
  it('returns full member list', async () => {
    const client = makeStubClient({
      info: { kind: 'mpim' },
      members: ['U_A', 'U_B', 'U_C'],
    });
    const resolver = createSlackAclResolver({
      client,
      tenantId: TENANT_ID,
    });

    const acl = await resolver.resolve({ tenantId: TENANT_ID, channelId: 'D2' });

    expect(acl.kind).toBe('mpim');
    expect(acl.isPublic).toBe(false);
    expect(acl.members).toEqual(['U_A', 'U_B', 'U_C']);
  });
});

describe('SlackAclResolver — tenant isolation', () => {
  it('throws at construction when client install tenant differs from configured tenant', () => {
    const client = makeStubClient({ info: { kind: 'im' }, members: [] });
    expect(() =>
      createSlackAclResolver({
        client,
        // Mismatch: client install belongs to TENANT_ID but we configure another.
        tenantId: 'tenant_beta',
      }),
    ).toThrow(/tenant mismatch/i);
  });

  it('quarantines on cross-tenant resolve calls', async () => {
    const client = makeStubClient({ info: { kind: 'im' }, members: ['U1'] });
    const logger = { warn: vi.fn() };
    const resolver = createSlackAclResolver({
      client,
      tenantId: TENANT_ID,
      logger,
    });

    const acl = await resolver.resolve({
      tenantId: 'tenant_beta',
      channelId: 'D1',
    });

    expect(acl.members).toEqual([]);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

describe('SlackAclResolver — failure modes', () => {
  it('quarantines when conversationsInfo fails', async () => {
    const client = {
      install: makeInstall(),
      connector: { id: 'slack:T0WORK001', call: vi.fn(), health: vi.fn() },
      conversationsInfo: vi.fn().mockResolvedValue({
        kind: 'upstream-error',
        status: 404,
        message: 'channel_not_found',
      }),
      conversationsMembers: vi.fn(),
      chatPostMessage: vi.fn(),
      usersInfo: vi.fn(),
      oauthV2Access: vi.fn(),
    } as unknown as SlackClient;

    const resolver = createSlackAclResolver({ client, tenantId: TENANT_ID });
    const acl = await resolver.resolve({ tenantId: TENANT_ID, channelId: 'C_GHOST' });

    expect(acl.members).toEqual([]);
    expect(acl.isPublic).toBe(false);
  });
});
