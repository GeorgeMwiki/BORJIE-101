/**
 * Tests for the four signal observers.
 */
import { describe, it, expect } from 'vitest';
import {
  observeConversation,
  observeDocument,
  observeSearch,
  observeTabEventPattern,
  tokeniseQuery,
} from '../signal-observers/index.js';

describe('observeConversation', () => {
  it('returns empty for missing tenant or user', () => {
    expect(
      observeConversation({
        tenantId: '',
        userId: 'u1',
        messageId: 'm1',
        entities: [['COMPLIANCE', 'tax']],
      }),
    ).toEqual([]);
    expect(
      observeConversation({
        tenantId: 't1',
        userId: '',
        messageId: 'm1',
        entities: [['COMPLIANCE', 'tax']],
      }),
    ).toEqual([]);
  });

  it('returns empty for no matching entities or intent', () => {
    const out = observeConversation({
      tenantId: 't1',
      userId: 'u1',
      messageId: 'm1',
      entities: [['WEATHER', 'sunny']],
    });
    expect(out).toEqual([]);
  });

  it('produces signals for matched entities', () => {
    const out = observeConversation({
      tenantId: 't1',
      userId: 'u1',
      messageId: 'm1',
      entities: [
        ['CONTRACT', 'lease'],
        ['COMPLIANCE', 'tax'],
      ],
    });
    expect(out.length).toBeGreaterThanOrEqual(2);
    const modules = out.map((s) => s.suggestedModuleTemplateId);
    expect(modules).toContain('LEGAL');
    expect(modules).toContain('COMPLIANCE');
    expect(out[0]?.signalKind).toBe('conversation_intent');
  });

  it('produces signals for matched intent', () => {
    const out = observeConversation({
      tenantId: 't1',
      userId: 'u1',
      messageId: 'm1',
      intent: 'compliance_query',
      entities: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.suggestedModuleTemplateId).toBe('COMPLIANCE');
  });

  it('survives missing entities array', () => {
    const out = observeConversation({
      tenantId: 't1',
      userId: 'u1',
      messageId: 'm1',
      intent: 'compliance_query',
      entities: undefined as unknown as ReadonlyArray<readonly [string, string]>,
    });
    expect(out).toHaveLength(1);
  });
});

describe('observeDocument', () => {
  it('returns empty for missing fields', () => {
    expect(
      observeDocument({
        tenantId: '',
        userId: 'u1',
        documentId: 'd1',
        docType: 'contract',
      }),
    ).toEqual([]);
    expect(
      observeDocument({
        tenantId: 't1',
        userId: 'u1',
        documentId: 'd1',
        docType: '',
      }),
    ).toEqual([]);
  });

  it('emits a signal for a known doc_type', () => {
    const out = observeDocument({
      tenantId: 't1',
      userId: 'u1',
      documentId: 'd1',
      docType: 'compliance_certificate',
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.suggestedModuleTemplateId).toBe('COMPLIANCE');
    expect(out[0]?.weight).toBeGreaterThan(0);
  });

  it('damps weight by confidence', () => {
    const high = observeDocument({
      tenantId: 't1',
      userId: 'u1',
      documentId: 'd1',
      docType: 'compliance_certificate',
      confidence: 1.0,
    });
    const low = observeDocument({
      tenantId: 't1',
      userId: 'u1',
      documentId: 'd1',
      docType: 'compliance_certificate',
      confidence: 0.3,
    });
    expect(high[0]?.weight).toBeGreaterThan(low[0]?.weight ?? 0);
  });

  it('clamps invalid confidence to 1', () => {
    const out = observeDocument({
      tenantId: 't1',
      userId: 'u1',
      documentId: 'd1',
      docType: 'compliance_certificate',
      confidence: 5,
    });
    // Out-of-range confidence treated as 1 (no damping).
    expect(out[0]?.weight).toBe(3);
  });

  it('returns empty for unknown doc_type', () => {
    const out = observeDocument({
      tenantId: 't1',
      userId: 'u1',
      documentId: 'd1',
      docType: 'random_thing',
    });
    expect(out).toEqual([]);
  });
});

describe('observeTabEventPattern', () => {
  it('returns empty for missing fields', () => {
    expect(
      observeTabEventPattern({
        tenantId: '',
        userId: 'u1',
        pattern: 'finance_visits_no_action',
        occurrences: 3,
      }),
    ).toEqual([]);
  });

  it('emits signal for known pattern', () => {
    const out = observeTabEventPattern({
      tenantId: 't1',
      userId: 'u1',
      pattern: 'finance_visits_no_action',
      occurrences: 1,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.suggestedModuleTemplateId).toBe('STRATEGY');
  });

  it('boosts weight with occurrence count', () => {
    const single = observeTabEventPattern({
      tenantId: 't1',
      userId: 'u1',
      pattern: 'finance_visits_no_action',
      occurrences: 1,
    });
    const many = observeTabEventPattern({
      tenantId: 't1',
      userId: 'u1',
      pattern: 'finance_visits_no_action',
      occurrences: 10,
    });
    expect(many[0]?.weight).toBeGreaterThan(single[0]?.weight ?? 0);
  });

  it('caps weight boost at 3x', () => {
    const cap = observeTabEventPattern({
      tenantId: 't1',
      userId: 'u1',
      pattern: 'finance_visits_no_action',
      occurrences: 1000,
    });
    const baseWeight = 1.5; // matches scoring matrix
    expect(cap[0]?.weight).toBeLessThanOrEqual(baseWeight * 3);
  });

  it('treats occurrences < 1 as 1', () => {
    const out = observeTabEventPattern({
      tenantId: 't1',
      userId: 'u1',
      pattern: 'finance_visits_no_action',
      occurrences: 0,
    });
    expect(out).toHaveLength(1);
  });
});

describe('observeSearch', () => {
  it('returns empty for missing fields', () => {
    expect(observeSearch({ tenantId: '', userId: 'u1', query: 'q' })).toEqual([]);
    expect(observeSearch({ tenantId: 't1', userId: 'u1', query: '' })).toEqual([]);
  });

  it('matches keywords', () => {
    const out = observeSearch({
      tenantId: 't1',
      userId: 'u1',
      query: 'find compliance documents',
    });
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]?.suggestedModuleTemplateId).toBe('COMPLIANCE');
    expect(out[0]?.signalKind).toBe('search_keyword');
  });

  it('returns empty for queries with no keyword match', () => {
    expect(
      observeSearch({ tenantId: 't1', userId: 'u1', query: 'weather forecast' }),
    ).toEqual([]);
  });
});

describe('tokeniseQuery', () => {
  it('returns empty for empty / non-string input', () => {
    expect(tokeniseQuery('')).toEqual([]);
    expect(tokeniseQuery(undefined as unknown as string)).toEqual([]);
  });

  it('lowercases and splits on non-alphanum', () => {
    expect(tokeniseQuery('Find Compliance-Reports!')).toEqual([
      'find',
      'compliance',
      'reports',
    ]);
  });

  it('drops tokens shorter than 2 characters', () => {
    expect(tokeniseQuery('a b cd ef')).toEqual(['cd', 'ef']);
  });
});
