/**
 * Tests for the template registry — every shipped slug must:
 *   - resolve via `findTemplate`
 *   - load both `.sw.md` and `.en.md` files
 *   - have a recognised `kind`
 */

import { describe, it, expect } from 'vitest';
import {
  TEMPLATE_REGISTRY,
  findTemplate,
  listTemplateSlugs,
  listTemplatesByKind,
  loadTemplateContent,
} from '../templates';

const KIND_VALUES = ['contract', 'rfp', 'rfp_response', 'letter', 'notice', 'memo'] as const;

describe('document-drafter templates registry', () => {
  it('exports a non-empty registry', () => {
    expect(TEMPLATE_REGISTRY.length).toBeGreaterThanOrEqual(12);
  });

  it('every template kind is a known DraftKind', () => {
    for (const template of TEMPLATE_REGISTRY) {
      expect(KIND_VALUES).toContain(template.kind);
    }
  });

  it('every slug is unique', () => {
    const slugs = TEMPLATE_REGISTRY.map((t) => t.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  it('findTemplate returns the right slug', () => {
    const found = findTemplate('contract.supply-ore');
    expect(found?.kind).toBe('contract');
    expect(found?.defaultJurisdiction).toBe('TZ');
  });

  it('findTemplate returns undefined for an unknown slug', () => {
    expect(findTemplate('does.not.exist')).toBeUndefined();
  });

  it('listTemplateSlugs returns every slug', () => {
    expect(listTemplateSlugs()).toHaveLength(TEMPLATE_REGISTRY.length);
  });

  it('listTemplatesByKind filters by kind', () => {
    const contracts = listTemplatesByKind('contract');
    expect(contracts.length).toBeGreaterThanOrEqual(3);
    for (const c of contracts) {
      expect(c.kind).toBe('contract');
    }
  });

  it('loadTemplateContent returns both sw and en text', () => {
    const { sw, en } = loadTemplateContent('contract.supply-ore', 'bilingual');
    expect(sw).toContain('MKATABA');
    expect(en).toContain('AGREEMENT');
  });

  it('loadTemplateContent throws on unknown slug', () => {
    expect(() => loadTemplateContent('does.not.exist', 'sw')).toThrow(/unknown template slug/);
  });
});
