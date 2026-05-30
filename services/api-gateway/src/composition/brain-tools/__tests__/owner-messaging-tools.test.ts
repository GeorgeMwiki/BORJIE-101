/**
 * owner.messaging.* — brain tool tests focused on the unread-count
 * regression.
 *
 * Catches the regression that shipped previously: the tool's GET path
 * was the wrong shape — it called `/owner/threads?tenantId=...` and
 * approximated unread by counting "open" threads. The fix routes the
 * call to the dedicated `/owner/threads/unread-count` endpoint which
 * returns a true (totalThreads, openThreads, unreadMessages) tuple.
 *
 * Coverage:
 *   - descriptor shape (id, persona scope, stakes, isWrite)
 *   - unread_count handler calls the dedicated endpoint with no query
 *     params (tenantId is bound from JWT — sending it pollutes logs)
 *   - unread_count handler exposes unreadMessages in the output
 *   - thread_list handler stops sending the noop tenantId query param
 */

import { describe, expect, it, vi } from 'vitest';

import {
  OWNER_MESSAGING_TOOLS,
  ownerMessagingUnreadCountTool,
  ownerMessagingThreadListTool,
} from '../owner-messaging-tools.js';

const OWNER_CTX = Object.freeze({
  tenantId: 'tenant-acme',
  actorId: 'user-mwikila',
  personaSlug: 'T1_owner_strategist',
});

function makeClient(getResult: unknown) {
  return {
    get: vi.fn(async () => getResult),
    post: vi.fn(async () => ({})),
  };
}

describe('ownerMessagingUnreadCountTool descriptor', () => {
  it('has the canonical id and persona scope', () => {
    expect(ownerMessagingUnreadCountTool.id).toBe(
      'owner.messaging.unread_count',
    );
    expect(ownerMessagingUnreadCountTool.personaSlugs).toEqual([
      'T1_owner_strategist',
    ]);
  });

  it('is LOW stakes READ-only', () => {
    expect(ownerMessagingUnreadCountTool.stakes).toBe('LOW');
    expect(ownerMessagingUnreadCountTool.isWrite).toBe(false);
  });
});

describe('ownerMessagingUnreadCountTool handler', () => {
  it('calls GET /owner/threads/unread-count with NO query params', async () => {
    const client = makeClient({
      success: true,
      data: { totalThreads: 4, openThreads: 3, unreadMessages: 11 },
    });
    const result = await ownerMessagingUnreadCountTool.handler(
      {},
      { ...OWNER_CTX, httpClient: client },
    );
    expect(client.get).toHaveBeenCalledTimes(1);
    const [path, init] = client.get.mock.calls[0]!;
    expect(path).toBe('/owner/threads/unread-count');
    // The route binds tenantId from the JWT — sending it as a query
    // param is a noop and was the original misdirection. Make sure
    // the call site stops doing that.
    expect(init).toBeUndefined();
    expect(result.totalThreads).toBe(4);
    expect(result.openThreads).toBe(3);
    expect(result.unreadMessages).toBe(11);
  });

  it('falls back to zero counts when the httpClient is missing', async () => {
    const result = await ownerMessagingUnreadCountTool.handler({}, OWNER_CTX);
    expect(result).toEqual({
      totalThreads: 0,
      openThreads: 0,
      unreadMessages: 0,
    });
  });

  it('coerces missing fields in the response payload to 0', async () => {
    const client = makeClient({ success: true, data: {} });
    const result = await ownerMessagingUnreadCountTool.handler(
      {},
      { ...OWNER_CTX, httpClient: client },
    );
    expect(result).toEqual({
      totalThreads: 0,
      openThreads: 0,
      unreadMessages: 0,
    });
  });
});

describe('ownerMessagingThreadListTool handler', () => {
  it('omits the noop tenantId query param', async () => {
    const client = makeClient({
      success: true,
      data: [
        {
          id: 't-1',
          subject: 'Cyanide tender',
          status: 'open',
          last_activity_at: '2026-05-30T00:00:00.000Z',
        },
      ],
    });
    await ownerMessagingThreadListTool.handler(
      { status: 'open', limit: 20 },
      { ...OWNER_CTX, httpClient: client },
    );
    const [path, init] = client.get.mock.calls[0]!;
    expect(path).toBe('/owner/threads');
    expect((init as { query: Record<string, unknown> }).query).toEqual({
      status: 'open',
      limit: 20,
    });
    expect(
      (init as { query: Record<string, unknown> }).query.tenantId,
    ).toBeUndefined();
  });
});

describe('OWNER_MESSAGING_TOOLS catalog', () => {
  it('exports exactly 3 tools', () => {
    expect(OWNER_MESSAGING_TOOLS).toHaveLength(3);
    const ids = OWNER_MESSAGING_TOOLS.map((t) => t.id).sort();
    expect(ids).toEqual([
      'owner.messaging.send_to',
      'owner.messaging.thread_list',
      'owner.messaging.unread_count',
    ]);
  });
});
