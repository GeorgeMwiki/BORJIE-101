/**
 * owner-tabs-tools tests — Wave OWNER-OS-DURABLE.
 *
 * Drives the 3 server-persisted tab brain tools with an in-memory
 * httpClient stub. Verifies:
 *
 *   - Each tool hits the correct /owner/tabs endpoint, forwards chat
 *     provenance (`via: 'chat'`), and normalises the response envelope.
 *   - The null-client branch returns a stable placeholder (never claims a
 *     server write happened) so the tool degrades gracefully in tests /
 *     when the loopback client is unbound.
 *   - Input schemas reject malformed input (strict, bounded, ≥1 field on
 *     update).
 *   - tabId path segments are url-encoded (path-injection defence).
 *   - The OWNER_TABS_TOOLS catalog exports exactly 3 owner+admin tools.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  OWNER_TABS_TOOLS,
  ownerTabsSpawnTool,
  ownerTabsCloseTool,
  ownerTabsUpdateTool,
} from '../owner-tabs-tools';

const OWNER_CTX = Object.freeze({
  tenantId: 'tenant-acme',
  actorId: 'user-mwikila',
  personaSlug: 'T1_owner_strategist',
  chatSessionId: 'sess-1',
  chatTurnId: 'turn-1',
});

// The loopback HTTP client unwraps `{ data }` envelopes before returning,
// so the stub resolves the inner object directly (what the handlers read).
function makeClient(postResult: unknown) {
  return {
    get: vi.fn(async () => ({})),
    post: vi.fn(async () => postResult),
  };
}

describe('ownerTabsSpawnTool', () => {
  it('posts to /owner/tabs with the tab + chat provenance', async () => {
    const client = makeClient({
      tab: { id: 'licence|licenceId:42' },
      isNew: true,
      updatedAt: '2026-06-05T10:00:00.000Z',
    });
    const result = await ownerTabsSpawnTool.handler(
      {
        tabId: 'licence|licenceId:42',
        kind: 'licence',
        title: 'Geita PML',
        context: { licenceId: '42', siteId: 'geita' },
        setActive: true,
      },
      { ...OWNER_CTX, httpClient: client },
    );
    expect(result.accepted).toBe(true);
    expect(result.tabId).toBe('licence|licenceId:42');
    expect(result.isNew).toBe(true);
    expect(client.post).toHaveBeenCalledTimes(1);
    const [path, body] = client.post.mock.calls[0]!;
    expect(path).toBe('/owner/tabs');
    const b = body as Record<string, unknown>;
    expect((b.tab as Record<string, unknown>).kind).toBe('licence');
    expect((b.provenance as Record<string, unknown>).via).toBe('chat');
  });

  it('returns a non-claiming placeholder when httpClient is absent', async () => {
    const result = await ownerTabsSpawnTool.handler(
      { tabId: 't1', kind: 'site', title: 'Site 1', setActive: true },
      OWNER_CTX,
    );
    expect(result.accepted).toBe(true);
    expect(result.tabId).toBe('t1');
    // isNew defaults true in the offline branch — but no network call fired.
    expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('rejects unknown extra keys (strict schema)', () => {
    const parsed = ownerTabsSpawnTool.inputSchema.safeParse({
      tabId: 't1',
      kind: 'site',
      title: 'Site 1',
      bogus: 'no',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an empty title', () => {
    const parsed = ownerTabsSpawnTool.inputSchema.safeParse({
      tabId: 't1',
      kind: 'site',
      title: '',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('ownerTabsCloseTool', () => {
  it('posts to the /:id/close alias with url-encoded id', async () => {
    const client = makeClient({
      closedTabId: 'licence one',
      updatedAt: '2026-06-05T10:00:00.000Z',
    });
    const result = await ownerTabsCloseTool.handler(
      { tabId: 'licence one', reason: 'done reviewing' },
      { ...OWNER_CTX, httpClient: client },
    );
    expect(result.accepted).toBe(true);
    expect(result.closedTabId).toBe('licence one');
    const [path, body] = client.post.mock.calls[0]!;
    expect(path).toBe('/owner/tabs/licence%20one/close');
    expect((body as Record<string, unknown>).operation).toBe('close');
    expect(
      ((body as Record<string, unknown>).provenance as Record<string, unknown>)
        .via,
    ).toBe('chat');
  });

  it('degrades to a placeholder without a client', async () => {
    const result = await ownerTabsCloseTool.handler(
      { tabId: 't1' },
      OWNER_CTX,
    );
    expect(result.closedTabId).toBe('t1');
  });
});

describe('ownerTabsUpdateTool', () => {
  it('posts the +N badge + merged context to the /:id/update alias', async () => {
    const client = makeClient({
      tab: { id: 'licence|42' },
      updatedAt: '2026-06-05T10:00:00.000Z',
    });
    const result = await ownerTabsUpdateTool.handler(
      {
        tabId: 'licence|42',
        title: 'Geita PML (3 alerts)',
        contextMerge: { alerts: 3 },
        pendingUpdates: 3,
        augmentedAt: '2026-06-05T09:59:00.000Z',
      },
      { ...OWNER_CTX, httpClient: client },
    );
    expect(result.accepted).toBe(true);
    expect(result.tabId).toBe('licence|42');
    const [path, body] = client.post.mock.calls[0]!;
    expect(path).toBe('/owner/tabs/licence%7C42/update');
    const b = body as Record<string, unknown>;
    expect(b.pendingUpdates).toBe(3);
    // contextMerge is forwarded as `context` for the route's PATCH merge.
    expect((b.context as Record<string, unknown>).alerts).toBe(3);
    expect((b.provenance as Record<string, unknown>).via).toBe('chat');
  });

  it('requires at least one mutable field', () => {
    const parsed = ownerTabsUpdateTool.inputSchema.safeParse({
      tabId: 'licence|42',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a pendingUpdates badge beyond the cap', () => {
    const parsed = ownerTabsUpdateTool.inputSchema.safeParse({
      tabId: 'licence|42',
      pendingUpdates: 1000,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('OWNER_TABS_TOOLS catalog', () => {
  it('exports exactly 3 tools with the expected ids', () => {
    expect(OWNER_TABS_TOOLS).toHaveLength(3);
    const ids = OWNER_TABS_TOOLS.map((t) => t.id).sort();
    expect(ids).toEqual(
      ['mining.ui.tabs.close', 'mining.ui.tabs.spawn', 'mining.ui.tabs.update'].sort(),
    );
  });

  it('every tool is a MEDIUM-stakes WRITE owner+admin tool', () => {
    for (const tool of OWNER_TABS_TOOLS) {
      expect(tool.stakes).toBe('MEDIUM');
      expect(tool.isWrite).toBe(true);
      expect(tool.requiresPolicyRuleLiteral).toBe(false);
      expect(tool.personaSlugs).toContain('T1_owner_strategist');
      expect(tool.personaSlugs).toContain('T2_admin_strategist');
      // Never reachable from worker / concierge personas.
      expect(tool.personaSlugs).not.toContain('T4_field_employee');
      expect(tool.personaSlugs).not.toContain('T5_customer_concierge');
    }
  });

  it('every WRITE handler references httpClient + withChatProvenance', () => {
    for (const tool of OWNER_TABS_TOOLS) {
      const src = tool.handler.toString();
      expect(src).toContain('httpClient');
      expect(src).toContain('withChatProvenance');
    }
  });
});
