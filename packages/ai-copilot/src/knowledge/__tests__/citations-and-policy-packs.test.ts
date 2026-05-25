/**
 * Tests for knowledge/citations + knowledge/policy-packs.
 *
 * Coverage: citation builder shape + zod validation, inline render,
 * policy pack lookup by country, listPolicyPacks totality.
 */

import { describe, it, expect } from 'vitest';
import {
  buildCitation,
  renderCitationInline,
  CitationSchema,
} from '../citations.js';
import type { KnowledgeChunk } from '../knowledge-store.js';
import {
  POLICY_PACKS,
  getPolicyPack,
  listPolicyPacks,
} from '../policy-packs.js';

function chunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    id: 'chk-1',
    tenantId: 'tenant-1',
    knowledgeSource: 'platform-seed',
    sourceId: 'tza-rental-act',
    sourceUrl: 'https://example.com/tza-rental-act',
    title: 'Tanzania Rental Act',
    chunkIndex: 2,
    countryCode: 'TZ',
    kind: 'policy_pack',
    content: 'Section 12, paragraph 3 — landlords must serve a notice...'.repeat(
      4,
    ),
    tags: [],
    metadata: {},
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  } as KnowledgeChunk;
}

describe('buildCitation', () => {
  it('produces a citationId prefixed with cit_', () => {
    const c = buildCitation(chunk());
    expect(c.citationId).toBe('cit_chk-1');
  });

  it('truncates quotedFrom to <=160 chars', () => {
    const c = buildCitation(chunk());
    expect(c.quotedFrom?.length ?? 0).toBeLessThanOrEqual(160);
  });

  it('passes the resulting object through CitationSchema validation', () => {
    const c = buildCitation(chunk());
    expect(() => CitationSchema.parse(c)).not.toThrow();
  });

  it('omits optional fields when missing on the chunk', () => {
    const c = buildCitation(
      chunk({
        sourceId: undefined,
        sourceUrl: undefined,
        countryCode: undefined,
      }),
    );
    expect(c.sourceId).toBeUndefined();
    expect(c.sourceUrl).toBeUndefined();
    expect(c.countryCode).toBeUndefined();
  });

  it('rejects malformed urls', () => {
    expect(() => buildCitation(chunk({ sourceUrl: 'not-a-url' }))).toThrow();
  });
});

describe('renderCitationInline', () => {
  it('includes country code parens', () => {
    const c = buildCitation(chunk({ countryCode: 'KE' }));
    expect(renderCitationInline(c)).toContain('(KE)');
  });

  it('omits country code when absent', () => {
    const c = buildCitation(chunk({ countryCode: undefined }));
    const out = renderCitationInline(c);
    expect(out).not.toContain('(');
  });

  it('appends section marker for sourceId when present', () => {
    const c = buildCitation(chunk({ sourceId: 'sec-12' }));
    expect(renderCitationInline(c)).toContain('§sec-12');
  });
});

describe('policy-packs', () => {
  it('exports all four EA country packs', () => {
    expect(Object.keys(POLICY_PACKS).sort()).toEqual(['KE', 'RW', 'TZ', 'UG']);
  });

  it('getPolicyPack returns the requested country pack', () => {
    expect(getPolicyPack('KE').countryCode).toBe('KE');
    expect(getPolicyPack('TZ').countryCode).toBe('TZ');
    expect(getPolicyPack('UG').countryCode).toBe('UG');
    expect(getPolicyPack('RW').countryCode).toBe('RW');
  });

  it('every pack has at least one keyReference', () => {
    for (const pack of listPolicyPacks()) {
      expect(pack.keyReferences.length).toBeGreaterThan(0);
    }
  });

  it('every keyReference has a non-empty section, heading, and summary', () => {
    for (const pack of listPolicyPacks()) {
      for (const ref of pack.keyReferences) {
        expect(ref.section.length).toBeGreaterThan(0);
        expect(ref.heading.length).toBeGreaterThan(0);
        expect(ref.summary.length).toBeGreaterThan(0);
      }
    }
  });

  it('every pack has tags that include landlord-tenant', () => {
    for (const pack of listPolicyPacks()) {
      expect(pack.tags).toContain('landlord-tenant');
    }
  });

  it('listPolicyPacks returns all four packs', () => {
    expect(listPolicyPacks().length).toBe(4);
  });

  it('emits a versioned 2024.x identifier for every pack', () => {
    for (const pack of listPolicyPacks()) {
      expect(pack.version).toMatch(/^2024\./);
    }
  });
});
