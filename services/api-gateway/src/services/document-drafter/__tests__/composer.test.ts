/**
 * Tests for the composer — placeholder fill, semantic-block expansion,
 * missing-placeholder reporting, and bilingual stitching.
 */

import { describe, it, expect } from 'vitest';
import { compose, placeholderSemanticGenerator, reviseContent } from '../composer';
import type { SemanticBlockGenerator } from '../composer';

const ECHO_GENERATOR: SemanticBlockGenerator = {
  async generate({ key, language }) {
    return `[ECHO:${key}:${language}]`;
  },
};

describe('document-drafter composer', () => {
  it('fills plain placeholders from fillVars', async () => {
    const out = await compose({
      kind: 'letter',
      templateSlug: 'memo.internal',
      language: 'sw',
      fillVars: {
        tenantName: 'Acme Mining Co.',
        fromName: 'Mwikila',
        fromRole: 'Founder',
        toName: 'Operations Manager',
        toRole: 'Manager',
        ccList: '—',
        memoDate: '2026-05-27',
        memoReference: 'MEMO-001',
        memoSubject: 'Pit safety review',
        impactProduction: 'minimal',
        impactCost: 'low',
        impactSafety: 'positive',
        impactWorkforce: 'no change',
        decisionDeadline: '2026-06-01',
      },
      generator: ECHO_GENERATOR,
    });
    expect(out.contentMd).toContain('Acme Mining Co.');
    expect(out.contentMd).toContain('Pit safety review');
    expect(out.contentMd).not.toContain('{{tenantName}}');
  });

  it('expands semantic blocks via the generator', async () => {
    const out = await compose({
      kind: 'memo',
      templateSlug: 'memo.internal',
      language: 'en',
      fillVars: {
        tenantName: 'X', fromName: 'M', fromRole: 'F', toName: 'A', toRole: 'B',
        ccList: '', memoDate: '', memoReference: '', memoSubject: '',
        impactProduction: '', impactCost: '', impactSafety: '', impactWorkforce: '',
        decisionDeadline: '',
      },
      generator: ECHO_GENERATOR,
    });
    expect(out.contentMd).toContain('[ECHO:purpose:en]');
    expect(out.contentMd).toContain('[ECHO:recommendation:en]');
    expect(out.semanticBlocks.length).toBeGreaterThan(0);
  });

  it('reports missing placeholders as [name] markers', async () => {
    const out = await compose({
      kind: 'memo',
      templateSlug: 'memo.internal',
      language: 'sw',
      fillVars: { tenantName: 'X' },
      generator: ECHO_GENERATOR,
    });
    expect(out.missingPlaceholders).toContain('fromName');
    expect(out.contentMd).toContain('[fromName]');
  });

  it('bilingual rendering stitches sw + en with a divider', async () => {
    const out = await compose({
      kind: 'contract',
      templateSlug: 'contract.supply-ore',
      language: 'bilingual',
      fillVars: {
        sellerName: 'Mwikila Mining',
        buyerName: 'East Africa Refiners',
        contractDate: '2026-05-27',
      },
      generator: ECHO_GENERATOR,
    });
    expect(out.contentMd).toContain('MKATABA WA KUSAMBAZA');
    expect(out.contentMd).toContain('ORE SUPPLY AGREEMENT');
    expect(out.contentMd).toMatch(/\n---\n/);
  });

  it('uses the placeholder generator when no LLM is wired', async () => {
    const out = await compose({
      kind: 'letter',
      templateSlug: 'letter.regulator.tumemadini',
      language: 'sw',
      fillVars: {
        tenantName: 'X', tenantAddress: '', tenantPhone: '', tenantEmail: '',
        letterDate: '2026-05-27', regulatorOfficeCity: 'Dodoma',
        ourReference: 'REF-1', letterSubject: 'Permit query',
        licenceNumber: 'PL-100', siteName: 'X', siteDistrict: 'Y', siteRegion: 'Z',
        licenceIssueDate: '', licenceStartDate: '', licenceEndDate: '',
        additionalAttachments: '', contactPersonName: '', contactPhone: '',
        contactEmail: '', signatoryName: '', signatoryRole: '',
      },
      generator: placeholderSemanticGenerator,
    });
    expect(out.contentMd).toContain('itajazwa na ubongo wa Borjie');
  });
});

describe('document-drafter reviseContent', () => {
  it('appends a revision-instruction footer when no LLM is wired', async () => {
    const revised = await reviseContent({
      originalContent: '# Original\nBody.',
      instruction: 'Tighten the opening paragraph.',
      language: 'sw',
      generator: placeholderSemanticGenerator,
    });
    expect(revised).toContain('# Original');
    expect(revised).toContain('Tighten the opening paragraph.');
    expect(revised).toContain('Maelekezo ya Marekebisho');
  });

  it('uses the LLM output when one is wired', async () => {
    const llm: SemanticBlockGenerator = {
      async generate() {
        return '# Revised\nNew body.';
      },
    };
    const revised = await reviseContent({
      originalContent: '# Original\nBody.',
      instruction: 'Rewrite the body.',
      language: 'en',
      generator: llm,
    });
    expect(revised).toBe('# Revised\nNew body.');
  });
});
