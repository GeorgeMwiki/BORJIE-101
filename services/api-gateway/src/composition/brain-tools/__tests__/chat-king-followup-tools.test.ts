/**
 * chat-king-followup-tools — descriptor metadata + http-client wiring.
 *
 * Verifies the 2 follow-up chat-king tools wrap their REAL gateway
 * routes correctly, that provenance is injected on every WRITE, and
 * that persona scoping enforces the owner / buyer boundary.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  CHAT_KING_FOLLOWUP_TOOLS,
  opsPartiesCreateTool,
  buyerNotificationsMarkReadTool,
} from '../chat-king-followup-tools';
import type { PersonaToolHandlerContext } from '../types';

function makeOwnerCtx(client: {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
}): PersonaToolHandlerContext {
  return {
    tenantId: '00000000-0000-0000-0000-000000000000',
    actorId: 'owner-1',
    personaSlug: 'T1_owner_strategist',
    chatSessionId: 'session-xyz',
    chatTurnId: 'turn-7',
    httpClient: client as unknown as PersonaToolHandlerContext['httpClient'],
  };
}

function makeBuyerCtx(client: {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
}): PersonaToolHandlerContext {
  return {
    tenantId: '00000000-0000-0000-0000-000000000000',
    actorId: 'buyer-1',
    personaSlug: 'T5_customer_concierge',
    chatSessionId: 'session-buyer',
    chatTurnId: 'turn-buyer',
    httpClient: client as unknown as PersonaToolHandlerContext['httpClient'],
  };
}

describe('CHAT_KING_FOLLOWUP_TOOLS catalog', () => {
  it('exports exactly 2 descriptors', () => {
    expect(CHAT_KING_FOLLOWUP_TOOLS).toHaveLength(2);
  });

  it('includes both follow-up tool ids', () => {
    const ids = CHAT_KING_FOLLOWUP_TOOLS.map((t) => t.id).sort();
    expect(ids).toEqual([
      'buyer.notifications.mark_read',
      'ops.parties.create',
    ]);
  });

  it('each tool is a WRITE with no policy-rule-literal flag', () => {
    for (const tool of CHAT_KING_FOLLOWUP_TOOLS) {
      expect(tool.isWrite).toBe(true);
      expect(tool.requiresPolicyRuleLiteral).toBe(false);
    }
  });
});

describe('opsPartiesCreateTool', () => {
  it('is owner-only, MEDIUM stakes', () => {
    expect(opsPartiesCreateTool.personaSlugs).toEqual([
      'T1_owner_strategist',
    ]);
    expect(opsPartiesCreateTool.stakes).toBe('MEDIUM');
  });

  it('posts to /ops/external-parties with provenance + defaults', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: { id: 'party-uuid-1' },
    });
    const ctx = makeOwnerCtx({ get: vi.fn(), post });
    const res = await opsPartiesCreateTool.handler(
      {
        partyType: 'broker',
        name: 'Acme Brokers Ltd',
        tin: '123-456-789',
        country: 'TZ',
      },
      ctx,
    );
    expect(res.id).toBe('party-uuid-1');
    expect(res.partyType).toBe('broker');
    expect(res.name).toBe('Acme Brokers Ltd');
    expect(post).toHaveBeenCalledOnce();
    const [url, body] = post.mock.calls[0]!;
    expect(url).toBe('/ops/external-parties');
    const typed = body as {
      partyType: string;
      name: string;
      tin: string | null;
      country: string;
      primaryContact: Record<string, unknown>;
      paymentTerms: Record<string, unknown>;
      provenance: { via: string; sessionId: string | null; turnId: string | null };
    };
    expect(typed.partyType).toBe('broker');
    expect(typed.tin).toBe('123-456-789');
    expect(typed.country).toBe('TZ');
    expect(typed.primaryContact).toEqual({});
    expect(typed.paymentTerms).toEqual({});
    expect(typed.provenance.via).toBe('chat');
    expect(typed.provenance.sessionId).toBe('session-xyz');
    expect(typed.provenance.turnId).toBe('turn-7');
  });

  it('rejects empty name at the schema layer', () => {
    const parsed = opsPartiesCreateTool.inputSchema.safeParse({
      partyType: 'broker',
      name: '',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown partyType at the schema layer', () => {
    const parsed = opsPartiesCreateTool.inputSchema.safeParse({
      partyType: 'no_such_type',
      name: 'Acme',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('buyerNotificationsMarkReadTool', () => {
  it('is buyer-only, LOW stakes', () => {
    expect(buyerNotificationsMarkReadTool.personaSlugs).toEqual([
      'T5_customer_concierge',
    ]);
    expect(buyerNotificationsMarkReadTool.stakes).toBe('LOW');
  });

  it('posts to /buyer/notifications/:id/read with provenance', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: { id: 'notif-1', readAt: '2026-05-31T12:00:00Z' },
    });
    const ctx = makeBuyerCtx({ get: vi.fn(), post });
    const res = await buyerNotificationsMarkReadTool.handler(
      { notificationId: 'notif-1' },
      ctx,
    );
    expect(res.id).toBe('notif-1');
    expect(res.readAt).toBe('2026-05-31T12:00:00Z');
    expect(post).toHaveBeenCalledOnce();
    const [url, body] = post.mock.calls[0]!;
    expect(url).toBe('/buyer/notifications/notif-1/read');
    const typed = body as { provenance: { via: string } };
    expect(typed.provenance.via).toBe('chat');
  });
});

describe('chat-king follow-up — httpClient unavailable degraded path', () => {
  it('opsPartiesCreateTool returns empty id without throwing', async () => {
    const ctx = {
      tenantId: 'tenant-1',
      actorId: 'owner-1',
      personaSlug: 'T1_owner_strategist',
    } as PersonaToolHandlerContext;
    const res = await opsPartiesCreateTool.handler(
      { partyType: 'buyer', name: 'X' },
      ctx,
    );
    expect(res.id).toBe('');
    expect(res.partyType).toBe('buyer');
  });

  it('buyerNotificationsMarkReadTool echoes the input id with null readAt', async () => {
    const ctx = {
      tenantId: 'tenant-1',
      actorId: 'buyer-1',
      personaSlug: 'T5_customer_concierge',
    } as PersonaToolHandlerContext;
    const res = await buyerNotificationsMarkReadTool.handler(
      { notificationId: 'notif-x' },
      ctx,
    );
    expect(res.id).toBe('notif-x');
    expect(res.readAt).toBeNull();
  });
});
