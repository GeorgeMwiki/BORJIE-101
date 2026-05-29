/**
 * chat-everywhere-tools tests — Wave CE-1.
 *
 * Drives the 6 chat-everywhere brain tools with an in-memory
 * httpClient stub. Verifies:
 *
 *   - Each chip-only tool returns a stable chip envelope without
 *     hitting the network.
 *   - Each tool's input schema rejects malformed input.
 *   - The connected-agent revoke tool hits the correct path,
 *     forwards chat provenance, and survives both response shapes.
 *   - The CHAT_EVERYWHERE_TOOLS catalog contains exactly 6 tools
 *     with the expected ids.
 *   - Persona scoping is enforced (revoke is owner-only).
 */

import { describe, it, expect, vi } from 'vitest';

import {
  CHAT_EVERYWHERE_TOOLS,
  uiPinTabTool,
  uiReorderTabTool,
  uiRemoveTabTool,
  uiExportPdfTool,
  uiMarkNotificationReadTool,
  ownerConnectedAgentRevokeTool,
} from '../chat-everywhere-tools.js';

const OWNER_CTX = Object.freeze({
  tenantId: 'tenant-acme',
  actorId: 'user-mwikila',
  personaSlug: 'T1_owner_strategist',
  chatSessionId: 'sess-1',
  chatTurnId: 'turn-1',
});

function makeClient(postResult: unknown) {
  return {
    get: vi.fn(async () => ({})),
    post: vi.fn(async () => postResult),
  };
}

describe('uiPinTabTool', () => {
  it('emits a chip with stable shape and no network call', async () => {
    const result = await uiPinTabTool.handler(
      { tabId: 'compliance', reason: 'always show' },
      OWNER_CTX,
    );
    expect(result.accepted).toBe(true);
    expect(result.tabId).toBe('compliance');
    expect(result.chipId).toMatch(/^pin_compliance_/);
    expect(result.emittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('rejects empty tabId via the input schema', () => {
    const parsed = uiPinTabTool.inputSchema.safeParse({ tabId: '' });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown extra keys (strict schema)', () => {
    const parsed = uiPinTabTool.inputSchema.safeParse({
      tabId: 't1',
      other: 'no',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('uiReorderTabTool', () => {
  it('emits a chip with the target index preserved', async () => {
    const result = await uiReorderTabTool.handler(
      { tabId: 'drafts', targetIndex: 3 },
      OWNER_CTX,
    );
    expect(result.accepted).toBe(true);
    expect(result.targetIndex).toBe(3);
    expect(result.tabId).toBe('drafts');
  });

  it('rejects negative target indexes', () => {
    const parsed = uiReorderTabTool.inputSchema.safeParse({
      tabId: 't1',
      targetIndex: -1,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects target indexes beyond the cap', () => {
    const parsed = uiReorderTabTool.inputSchema.safeParse({
      tabId: 't1',
      targetIndex: 999,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('uiRemoveTabTool', () => {
  it('emits an undo-window hint to the FE', async () => {
    const result = await uiRemoveTabTool.handler(
      { tabId: 'custom-1' },
      OWNER_CTX,
    );
    expect(result.accepted).toBe(true);
    expect(result.undoWindowMs).toBeGreaterThanOrEqual(30_000);
  });
});

describe('uiExportPdfTool', () => {
  it('emits a chip and preserves the viewId', async () => {
    const result = await uiExportPdfTool.handler(
      { viewId: 'daily_brief', lang: 'sw' },
      OWNER_CTX,
    );
    expect(result.viewId).toBe('daily_brief');
    expect(result.accepted).toBe(true);
  });

  it('declares LOW stakes (read-side-effect, no DB write)', () => {
    expect(uiExportPdfTool.stakes).toBe('LOW');
    expect(uiExportPdfTool.isWrite).toBe(false);
  });
});

describe('uiMarkNotificationReadTool', () => {
  it("accepts the literal 'all' as a notification id", () => {
    const parsed = uiMarkNotificationReadTool.inputSchema.safeParse({
      notificationId: 'all',
    });
    expect(parsed.success).toBe(true);
  });

  it('emits a chip preserving the notification id', async () => {
    const result = await uiMarkNotificationReadTool.handler(
      { notificationId: 'noti-42' },
      OWNER_CTX,
    );
    expect(result.notificationId).toBe('noti-42');
  });
});

describe('ownerConnectedAgentRevokeTool', () => {
  it('throws when httpClient is absent (fail-loud)', async () => {
    await expect(
      ownerConnectedAgentRevokeTool.handler(
        { tokenId: 'tok-1', reason: 'no longer trusted' },
        OWNER_CTX,
      ),
    ).rejects.toThrow(/requires httpClient/);
  });

  it('hits the canonical revoke endpoint with chat provenance', async () => {
    const client = makeClient({
      data: { revoked: true, tokenId: 'tok-1', revokedAt: '2026-05-29T12:00:00.000Z' },
    });
    const result = await ownerConnectedAgentRevokeTool.handler(
      {
        tokenId: 'tok-1',
        reason: 'cred rotation',
        clientLabel: 'OpenAI MCP bridge',
      },
      { ...OWNER_CTX, httpClient: client },
    );
    expect(result.revoked).toBe(true);
    expect(result.tokenId).toBe('tok-1');
    expect(client.post).toHaveBeenCalledTimes(1);
    const [path, body] = client.post.mock.calls[0]!;
    expect(path).toBe('/oauth/agent-tokens/tok-1/revoke');
    expect((body as Record<string, unknown>).reason).toBe('cred rotation');
    expect(
      ((body as Record<string, unknown>).provenance as Record<string, unknown>)
        .via,
    ).toBe('chat');
  });

  it('also accepts the flat (non-data) response envelope', async () => {
    const client = makeClient({
      revoked: true,
      tokenId: 'tok-2',
      revokedAt: '2026-05-29T12:00:00.000Z',
    });
    const result = await ownerConnectedAgentRevokeTool.handler(
      { tokenId: 'tok-2', reason: 'rotation' },
      { ...OWNER_CTX, httpClient: client },
    );
    expect(result.revoked).toBe(true);
    expect(result.tokenId).toBe('tok-2');
  });

  it('url-encodes the tokenId segment to defend against path injection', async () => {
    const client = makeClient({ revoked: true });
    await ownerConnectedAgentRevokeTool.handler(
      { tokenId: 'tok with space', reason: 'r' },
      { ...OWNER_CTX, httpClient: client },
    );
    const [path] = client.post.mock.calls[0]!;
    expect(path).toBe('/oauth/agent-tokens/tok%20with%20space/revoke');
  });

  it('declares HIGH stakes + isWrite=true (auth-surface)', () => {
    expect(ownerConnectedAgentRevokeTool.stakes).toBe('HIGH');
    expect(ownerConnectedAgentRevokeTool.isWrite).toBe(true);
  });

  it('is scoped to owner persona only (no admin)', () => {
    expect(ownerConnectedAgentRevokeTool.personaSlugs).toEqual([
      'T1_owner_strategist',
    ]);
  });

  it('requires a non-empty reason for the audit chain', () => {
    const parsed = ownerConnectedAgentRevokeTool.inputSchema.safeParse({
      tokenId: 'tok-1',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('CHAT_EVERYWHERE_TOOLS catalog', () => {
  it('exports exactly 6 tools with the expected ids', () => {
    expect(CHAT_EVERYWHERE_TOOLS).toHaveLength(6);
    const ids = CHAT_EVERYWHERE_TOOLS.map((t) => t.id).sort();
    expect(ids).toEqual(
      [
        'mining.ui.export_pdf',
        'mining.ui.mark_notification_read',
        'mining.ui.pin_tab',
        'mining.ui.remove_tab',
        'mining.ui.reorder_tab',
        'owner.connected_agents.revoke',
      ].sort(),
    );
  });

  it('every tool is owner-scoped (T1) — never reachable from worker / concierge', () => {
    for (const tool of CHAT_EVERYWHERE_TOOLS) {
      expect(tool.personaSlugs).toContain('T1_owner_strategist');
      expect(tool.personaSlugs).not.toContain('T4_field_employee');
      expect(tool.personaSlugs).not.toContain('T5_customer_concierge');
    }
  });
});
