/**
 * JC-1 + JC-6 brain tool descriptor tests.
 *
 * Covers:
 *   - mwikila.jurisdiction.discover: descriptor shape, persona scope, fallback path.
 *   - mwikila.jurisdiction.switch: accepts 'turn' + 'session', REJECTS 'permanent'.
 *   - mwikila.jurisdiction.switch: bilingual sw/en confirmation message.
 *
 * The persona-gate adapter (toBrainToolHandler) is tested separately
 * — this file verifies the raw descriptor contract.
 */

import { describe, it, expect } from 'vitest';

import {
  jurisdictionDiscoverTool,
  jurisdictionSwitchTool,
  jurisdictionIngestComplianceTool,
  JURISDICTION_DISCOVERY_TOOLS,
} from '../jurisdiction-discovery-tools';

describe('JC-1 — mwikila.jurisdiction.discover descriptor', () => {
  it('is registered with the correct id, READ stakes, no audit chain', () => {
    expect(jurisdictionDiscoverTool.id).toBe('mwikila.jurisdiction.discover');
    expect(jurisdictionDiscoverTool.stakes).toBe('LOW');
    expect(jurisdictionDiscoverTool.isWrite).toBe(false);
    expect(jurisdictionDiscoverTool.requiresPolicyRuleLiteral).toBe(false);
  });

  it('is persona-wide — every persona can ask about jurisdiction', () => {
    // Sanity: every defined persona slug must be in the descriptor.
    expect(jurisdictionDiscoverTool.personaSlugs.length).toBeGreaterThanOrEqual(7);
  });

  it('description tells the LLM Mr. Mwikila NEVER says "I don\'t know"', () => {
    const desc = jurisdictionDiscoverTool.description;
    expect(desc).toContain("NEVER says \"I don't know\"");
  });

  it('fallback path returns a low-confidence stub when httpClient is unavailable', async () => {
    const out = await jurisdictionDiscoverTool.handler(
      { country: 'Peru' },
      {
        tenantId: 't_1',
        actorId: 'u_1',
        personaSlug: 'T1_owner_strategist',
        // No httpClient → fallback branch.
      },
    );
    expect(out.lowConfidence).toBe(true);
    expect(out.origin).toBe('fallback');
    expect(out.regulators.length).toBeGreaterThan(0);
    expect(out.promotionHint).toMatch(/admin/i);
  });
});

describe('JC-6 — mwikila.jurisdiction.switch descriptor', () => {
  it('is registered with the correct id', () => {
    expect(jurisdictionSwitchTool.id).toBe('mwikila.jurisdiction.switch');
  });

  it('description forbids scope:permanent + points to admin route', () => {
    const desc = jurisdictionSwitchTool.description;
    expect(desc).toContain('NEVER pass scope="permanent"');
    expect(desc).toContain('LOCKED at signup');
    expect(desc).toContain('Borjie internal admin');
  });

  it('input schema accepts scope "turn"', () => {
    const parsed = jurisdictionSwitchTool.inputSchema.safeParse({
      countryCode: 'KE',
      scope: 'turn',
    });
    expect(parsed.success).toBe(true);
  });

  it('input schema accepts scope "session"', () => {
    const parsed = jurisdictionSwitchTool.inputSchema.safeParse({
      countryCode: 'KE',
      scope: 'session',
    });
    expect(parsed.success).toBe(true);
  });

  it('input schema REJECTS scope "permanent"', () => {
    const parsed = jurisdictionSwitchTool.inputSchema.safeParse({
      countryCode: 'KE',
      scope: 'permanent',
    });
    expect(parsed.success).toBe(false);
  });

  it('input schema rejects non-alpha-2 codes', () => {
    const parsed = jurisdictionSwitchTool.inputSchema.safeParse({
      countryCode: 'PERU',
      scope: 'turn',
    });
    expect(parsed.success).toBe(false);
  });

  it('handler returns bilingual sw/en message for turn scope', async () => {
    const out = await jurisdictionSwitchTool.handler(
      { countryCode: 'KE', scope: 'turn' },
      {
        tenantId: 't_1',
        actorId: 'u_1',
        personaSlug: 'T1_owner_strategist',
      },
    );
    expect(out.acknowledged).toBe(true);
    expect(out.countryCode).toBe('KE');
    expect(out.scope).toBe('turn');
    expect(out.message.en).toMatch(/KE/);
    expect(out.message.sw).toMatch(/KE/);
  });

  it('handler reminds the user the account stays locked for session scope', async () => {
    const out = await jurisdictionSwitchTool.handler(
      { countryCode: 'UG', scope: 'session' },
      {
        tenantId: 't_1',
        actorId: 'u_1',
        personaSlug: 'T1_owner_strategist',
      },
    );
    expect(out.message.en).toMatch(/locked/i);
    expect(out.message.sw).toMatch(/imefungwa/i);
  });
});

describe('JC-7c — mwikila.jurisdiction.ingest_compliance descriptor', () => {
  it('is admin-only, HIGH stakes, write, policy-literal (mirrors promote)', () => {
    expect(jurisdictionIngestComplianceTool.id).toBe(
      'mwikila.jurisdiction.ingest_compliance',
    );
    expect(jurisdictionIngestComplianceTool.personaSlugs).toEqual([
      'T2_admin_strategist',
    ]);
    expect(jurisdictionIngestComplianceTool.stakes).toBe('HIGH');
    expect(jurisdictionIngestComplianceTool.isWrite).toBe(true);
    expect(jurisdictionIngestComplianceTool.requiresPolicyRuleLiteral).toBe(true);
  });

  it('input schema requires title + content and validates the code', () => {
    const ok = jurisdictionIngestComplianceTool.inputSchema.safeParse({
      countryCode: 'US',
      title: 'US Mining Law',
      content: 'Royalty on gold is six percent.',
    });
    expect(ok.success).toBe(true);

    const noContent = jurisdictionIngestComplianceTool.inputSchema.safeParse({
      countryCode: 'US',
      title: 'US Mining Law',
    });
    expect(noContent.success).toBe(false);

    const badCode = jurisdictionIngestComplianceTool.inputSchema.safeParse({
      countryCode: 'UNITEDSTATES',
      title: 'X',
      content: 'y',
    });
    expect(badCode.success).toBe(false);
  });

  it('description states it feeds the SHARED corpus + forbids private data', () => {
    const desc = jurisdictionIngestComplianceTool.description;
    expect(desc).toContain('SHARED');
    expect(desc).toMatch(/never tenant-private/i);
  });

  it('handler POSTs to the ingest-compliance route via httpClient', async () => {
    const calls: Array<{ path: string; body: any }> = [];
    const out = await jurisdictionIngestComplianceTool.handler(
      {
        countryCode: 'US',
        title: 'US Mining Law',
        content: 'Royalty on gold is six percent.',
        docType: 'mining_act',
      },
      {
        tenantId: 't_1',
        actorId: 'u_1',
        personaSlug: 'T2_admin_strategist',
        httpClient: {
          async get() {
            throw new Error('unexpected get');
          },
          async post(path: string, body: any) {
            calls.push({ path, body });
            return {
              ingested: true,
              chunks: 1,
              country: 'US',
              source: 'admin:jurisdiction:US',
              embedded: false,
              note: 'text-only',
            };
          },
        },
      } as any,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/admin/jurisdictions/US/ingest-compliance');
    expect(calls[0]?.body.title).toBe('US Mining Law');
    expect(calls[0]?.body.content).toContain('Royalty');
    expect(calls[0]?.body.docType).toBe('mining_act');
    expect(out.ingested).toBe(true);
  });

  it('handler throws without an httpClient (no silent no-op)', async () => {
    await expect(
      jurisdictionIngestComplianceTool.handler(
        { countryCode: 'US', title: 'X', content: 'y' },
        {
          tenantId: 't_1',
          actorId: 'u_1',
          personaSlug: 'T2_admin_strategist',
        } as any,
      ),
    ).rejects.toThrow(/httpClient/);
  });
});

describe('JURISDICTION_DISCOVERY_TOOLS catalog', () => {
  it('exposes discover + switch + promote + ingest_compliance in the frozen catalog', () => {
    const ids = JURISDICTION_DISCOVERY_TOOLS.map((d) => d.id);
    expect(ids).toContain('mwikila.jurisdiction.discover');
    expect(ids).toContain('mwikila.jurisdiction.switch');
    expect(ids).toContain('mwikila.jurisdiction.promote');
    expect(ids).toContain('mwikila.jurisdiction.ingest_compliance');
  });
});
