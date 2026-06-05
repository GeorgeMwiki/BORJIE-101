/**
 * damage-settlement-tools — descriptor metadata + http-client wiring.
 *
 * Verifies the 3 damage-settlement chat tools (ported from the BN dispute /
 * damage-deduction + conditional-survey chat tools, retargeted real-estate →
 * mining) wrap their REAL `/damage-claims/*` gateway routes correctly, that
 * provenance is injected on every WRITE, that persona scoping enforces the
 * owner boundary, and that the httpClient-unavailable path degrades honestly
 * (no fabricated data).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  DAMAGE_SETTLEMENT_TOOLS,
  siteDamageClaimSettleTool,
  siteDamageClaimRespondTool,
  siteRehabilitationApprovePlanTool,
} from '../damage-settlement-tools';
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

describe('DAMAGE_SETTLEMENT_TOOLS catalog', () => {
  it('exports exactly 3 descriptors', () => {
    expect(DAMAGE_SETTLEMENT_TOOLS).toHaveLength(3);
  });

  it('includes the three damage-settlement tool ids', () => {
    const ids = DAMAGE_SETTLEMENT_TOOLS.map((t) => t.id).sort();
    expect(ids).toEqual([
      'site.damage_claim.respond',
      'site.damage_claim.settle',
      'site.rehabilitation.approve_plan',
    ]);
  });

  it('every tool is OWNER-only, HIGH stakes, WRITE, no policy-rule-literal', () => {
    for (const tool of DAMAGE_SETTLEMENT_TOOLS) {
      expect(tool.personaSlugs).toEqual(['T1_owner_strategist']);
      expect(tool.stakes).toBe('HIGH');
      expect(tool.isWrite).toBe(true);
      expect(tool.requiresPolicyRuleLiteral).toBe(false);
    }
  });

  it('every tool name carries both EN and SW copy', () => {
    for (const tool of DAMAGE_SETTLEMENT_TOOLS) {
      expect(tool.name).toContain('(en)');
      expect(tool.name).toContain('(sw)');
    }
  });
});

describe('siteDamageClaimSettleTool', () => {
  it('posts to /damage-claims/:id/settle with provenance + agreed amount', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: 'claim-1',
        status: 'agreed',
        agreed_amount_minor: 50000,
        settled_at: '2026-06-05T10:00:00Z',
      },
    });
    const ctx = makeOwnerCtx({ get: vi.fn(), post });
    const res = await siteDamageClaimSettleTool.handler(
      { claimId: 'claim-1', agreedAmountMinor: 50000, notes: 'agreed in chat' },
      ctx,
    );
    expect(res.id).toBe('claim-1');
    expect(res.status).toBe('agreed');
    expect(res.agreedAmountMinor).toBe(50000);
    expect(res.settledAt).toBe('2026-06-05T10:00:00Z');
    expect(post).toHaveBeenCalledOnce();
    const [url, body] = post.mock.calls[0]!;
    expect(url).toBe('/damage-claims/claim-1/settle');
    const typed = body as {
      agreedAmountMinor: number;
      notes: string;
      provenance: { via: string; sessionId: string | null; turnId: string | null };
    };
    expect(typed.agreedAmountMinor).toBe(50000);
    expect(typed.notes).toBe('agreed in chat');
    expect(typed.provenance.via).toBe('chat');
    expect(typed.provenance.sessionId).toBe('session-xyz');
    expect(typed.provenance.turnId).toBe('turn-7');
  });

  it('omits notes from the body when not supplied (exactOptionalPropertyTypes)', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: { id: 'claim-2', status: 'agreed', agreed_amount_minor: 100 },
    });
    const ctx = makeOwnerCtx({ get: vi.fn(), post });
    await siteDamageClaimSettleTool.handler(
      { claimId: 'claim-2', agreedAmountMinor: 100 },
      ctx,
    );
    const [, body] = post.mock.calls[0]!;
    expect(Object.prototype.hasOwnProperty.call(body, 'notes')).toBe(false);
  });

  it('rejects a negative agreed amount at the schema layer', () => {
    const parsed = siteDamageClaimSettleTool.inputSchema.safeParse({
      claimId: 'claim-1',
      agreedAmountMinor: -1,
    });
    expect(parsed.success).toBe(false);
  });

  it('degrades honestly when httpClient is unavailable', async () => {
    const ctx = {
      tenantId: 'tenant-1',
      actorId: 'owner-1',
      personaSlug: 'T1_owner_strategist',
    } as PersonaToolHandlerContext;
    const res = await siteDamageClaimSettleTool.handler(
      { claimId: 'claim-1', agreedAmountMinor: 50000 },
      ctx,
    );
    expect(res.id).toBe('');
    expect(res.status).toBe('unavailable');
    expect(res.agreedAmountMinor).toBe(50000);
    expect(res.settledAt).toBeNull();
  });
});

describe('siteDamageClaimRespondTool', () => {
  it('posts to /damage-claims/:id/respond with counter + rationale + provenance', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: 'claim-9',
        status: 'negotiating',
        counter_proposal_minor: 25000,
      },
    });
    const ctx = makeOwnerCtx({ get: vi.fn(), post });
    const res = await siteDamageClaimRespondTool.handler(
      {
        claimId: 'claim-9',
        counterProposalMinor: 25000,
        rationale: 'counter — see inspection report',
      },
      ctx,
    );
    expect(res.id).toBe('claim-9');
    expect(res.status).toBe('negotiating');
    expect(res.counterProposalMinor).toBe(25000);
    const [url, body] = post.mock.calls[0]!;
    expect(url).toBe('/damage-claims/claim-9/respond');
    const typed = body as {
      counterProposalMinor: number | null;
      rationale: string;
      provenance: { via: string };
    };
    expect(typed.counterProposalMinor).toBe(25000);
    expect(typed.rationale).toBe('counter — see inspection report');
    expect(typed.provenance.via).toBe('chat');
  });

  it('requires a rationale at the schema layer', () => {
    const parsed = siteDamageClaimRespondTool.inputSchema.safeParse({
      claimId: 'claim-9',
      rationale: '',
    });
    expect(parsed.success).toBe(false);
  });

  it('degrades honestly when httpClient is unavailable', async () => {
    const ctx = {
      tenantId: 'tenant-1',
      actorId: 'owner-1',
      personaSlug: 'T1_owner_strategist',
    } as PersonaToolHandlerContext;
    const res = await siteDamageClaimRespondTool.handler(
      { claimId: 'claim-9', counterProposalMinor: 25000, rationale: 'x' },
      ctx,
    );
    expect(res.id).toBe('');
    expect(res.status).toBe('unavailable');
    expect(res.counterProposalMinor).toBe(25000);
  });
});

describe('siteRehabilitationApprovePlanTool', () => {
  it('posts to the nested rehabilitation approve route with provenance', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: 'action-1',
        status: 'approved',
        approved_at: '2026-06-05T11:00:00Z',
      },
    });
    const ctx = makeOwnerCtx({ get: vi.fn(), post });
    const res = await siteRehabilitationApprovePlanTool.handler(
      { rehabilitationPlanId: 'plan-1', actionPlanId: 'action-1' },
      ctx,
    );
    expect(res.id).toBe('action-1');
    expect(res.status).toBe('approved');
    expect(res.approvedAt).toBe('2026-06-05T11:00:00Z');
    const [url, body] = post.mock.calls[0]!;
    expect(url).toBe(
      '/damage-claims/rehabilitation-plans/plan-1/action-plans/action-1/approve',
    );
    const typed = body as { provenance: { via: string } };
    expect(typed.provenance.via).toBe('chat');
  });

  it('degrades honestly when httpClient is unavailable', async () => {
    const ctx = {
      tenantId: 'tenant-1',
      actorId: 'owner-1',
      personaSlug: 'T1_owner_strategist',
    } as PersonaToolHandlerContext;
    const res = await siteRehabilitationApprovePlanTool.handler(
      { rehabilitationPlanId: 'plan-1', actionPlanId: 'action-1' },
      ctx,
    );
    expect(res.id).toBe('');
    expect(res.status).toBe('unavailable');
    expect(res.approvedAt).toBeNull();
  });
});
