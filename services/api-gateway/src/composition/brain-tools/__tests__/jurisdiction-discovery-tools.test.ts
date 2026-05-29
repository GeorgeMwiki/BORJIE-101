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

describe('JURISDICTION_DISCOVERY_TOOLS catalog', () => {
  it('exposes both discover + switch in the frozen catalog', () => {
    const ids = JURISDICTION_DISCOVERY_TOOLS.map((d) => d.id);
    expect(ids).toContain('mwikila.jurisdiction.discover');
    expect(ids).toContain('mwikila.jurisdiction.switch');
  });
});
