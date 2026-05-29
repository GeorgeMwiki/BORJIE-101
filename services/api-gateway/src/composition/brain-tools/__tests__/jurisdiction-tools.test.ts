/**
 * JA-4 — Jurisdiction brain tools tests.
 *
 * Verifies:
 *   - jurisdictionShowCurrentTool descriptor shape (id, persona scope,
 *     stakes, isWrite, schemas)
 *   - tool is registered in the merged catalog through index.ts
 *   - handler short-circuits with a descriptive error when DATABASE_URL
 *     is missing (no DB available — covers the "boot without Postgres"
 *     path documented in db-client.ts)
 *   - NO conflict with the JC catalog's `mwikila.jurisdiction.switch` id
 *     (we removed our JA-5 entry to avoid duplicate-id merge warnings)
 */

import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  JURISDICTION_TOOLS,
  jurisdictionShowCurrentTool,
} from '../jurisdiction-tools.js';
import { listPersonaToolDescriptors } from '../index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('JA-4 jurisdictionShowCurrentTool descriptor', () => {
  it('has the correct id', () => {
    expect(jurisdictionShowCurrentTool.id).toBe(
      'mwikila.jurisdiction.show_current',
    );
  });

  it('is persona-gated to owner + admin', () => {
    expect(jurisdictionShowCurrentTool.personaSlugs).toEqual([
      'T1_owner_strategist',
      'T2_admin_strategist',
    ]);
  });

  it('is LOW stakes and READ-only', () => {
    expect(jurisdictionShowCurrentTool.stakes).toBe('LOW');
    expect(jurisdictionShowCurrentTool.isWrite).toBe(false);
    expect(jurisdictionShowCurrentTool.requiresPolicyRuleLiteral).toBe(false);
  });

  it('exports a single tool in JURISDICTION_TOOLS', () => {
    expect(JURISDICTION_TOOLS).toHaveLength(1);
    expect(JURISDICTION_TOOLS[0]?.id).toBe(
      'mwikila.jurisdiction.show_current',
    );
  });

  it('input schema accepts language enum', () => {
    const parsed = jurisdictionShowCurrentTool.inputSchema.safeParse({
      language: 'sw',
    });
    expect(parsed.success).toBe(true);
  });

  it('input schema rejects unknown language', () => {
    const parsed = jurisdictionShowCurrentTool.inputSchema.safeParse({
      language: 'fr',
    });
    expect(parsed.success).toBe(false);
  });

  it('output schema admits the bilingual snapshot', () => {
    const parsed = jurisdictionShowCurrentTool.outputSchema.safeParse({
      country: 'TZ',
      countryName: 'Tanzania',
      currency: 'TZS',
      defaultLanguage: 'sw',
      locale: 'sw-TZ',
      timeZone: 'Africa/Dar_es_Salaam',
      mineralAuthority: 'PCCB',
      environmentalAuthority: 'NEMC',
      transparencyInitiative: 'EITI',
      auditAuthority: 'TMAA',
      formattedEn: 'Your operation is in TZ ...',
      formattedSw: 'Mgodi wako uko TZ ...',
      source: 'tenant',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('JA-4 — registration in brain-tools catalog', () => {
  it('appears in the merged persona-aware tool catalog', () => {
    const ids = listPersonaToolDescriptors().map((d) => d.id);
    expect(ids).toContain('mwikila.jurisdiction.show_current');
  });

  it('does NOT conflict with the JC-6 switch tool id', () => {
    // JC-6 owns `mwikila.jurisdiction.switch` — we must NOT re-register
    // it in the JA-4 catalog (would cause a duplicate-id merge warning).
    const ja4Ids = JURISDICTION_TOOLS.map((d) => d.id);
    expect(ja4Ids).not.toContain('mwikila.jurisdiction.switch');
  });

  it('JC-6 switch tool is still present (peaceful coexistence)', () => {
    const ids = listPersonaToolDescriptors().map((d) => d.id);
    expect(ids).toContain('mwikila.jurisdiction.switch');
    expect(ids).toContain('mwikila.jurisdiction.discover');
  });
});

describe('JA-4 — handler degraded-mode behavior', () => {
  it('throws a descriptive error when DATABASE_URL is unset', async () => {
    // The getDb singleton returns null when DATABASE_URL is missing
    // (db-client.ts contract). The tool surfaces that as a clear
    // "database unavailable" error so the orchestrator can render a
    // graceful fallback instead of a silent timeout.
    vi.doMock('../../db-client.js', () => ({
      getDb: () => null,
    }));
    const reloaded = await import('../jurisdiction-tools.js');
    await expect(
      reloaded.jurisdictionShowCurrentTool.handler(
        { language: 'en' },
        {
          tenantId: 't-1',
          actorId: 'a-1',
          personaSlug: 'T1_owner_strategist',
        },
      ),
    ).rejects.toThrow(/database unavailable/);
  });
});
