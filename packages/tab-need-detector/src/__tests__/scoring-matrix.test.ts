/**
 * Tests for scoring-matrix.ts — pure functions, deterministic.
 */
import { describe, it, expect } from 'vitest';
import {
  defaultWeightForKind,
  evaluateDocType,
  evaluateExternalTrigger,
  evaluateIntentLabel,
  evaluateNerEntities,
  evaluateSearchQuery,
  evaluateTabEventPattern,
} from '../scoring-matrix.js';

describe('evaluateSearchQuery', () => {
  it('returns empty array for empty / null queries', () => {
    expect(evaluateSearchQuery('')).toEqual([]);
    expect(evaluateSearchQuery(undefined as unknown as string)).toEqual([]);
    expect(evaluateSearchQuery(null as unknown as string)).toEqual([]);
  });

  it('matches a single compliance keyword', () => {
    const hits = evaluateSearchQuery('show me compliance reports');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]?.suggestedModuleTemplateId).toBe('COMPLIANCE');
    expect(hits[0]?.weight).toBeGreaterThan(0);
  });

  it('matches multiple keywords in one query', () => {
    const hits = evaluateSearchQuery('compliance audit and tax filings');
    const modules = hits.map((h) => h.suggestedModuleTemplateId);
    expect(modules).toContain('COMPLIANCE');
    // 'audit' and 'compliance' and 'tax' all map to COMPLIANCE
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });

  it('is case-insensitive', () => {
    const lower = evaluateSearchQuery('fleet');
    const upper = evaluateSearchQuery('FLEET');
    expect(lower.length).toBe(upper.length);
    expect(lower[0]?.suggestedModuleTemplateId).toBe('FLEET');
  });

  it('returns empty for queries with no matching keywords', () => {
    expect(evaluateSearchQuery('show me the weather')).toEqual([]);
  });
});

describe('evaluateNerEntities', () => {
  it('returns empty for empty array', () => {
    expect(evaluateNerEntities([])).toEqual([]);
  });

  it('returns empty for non-array input', () => {
    expect(
      evaluateNerEntities(undefined as unknown as ReadonlyArray<readonly [string, string]>),
    ).toEqual([]);
  });

  it('matches a COMPLIANCE entity', () => {
    const hits = evaluateNerEntities([['COMPLIANCE', 'tax compliance']]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.suggestedModuleTemplateId).toBe('COMPLIANCE');
  });

  it('matches LEGAL entities', () => {
    const hits = evaluateNerEntities([
      ['CONTRACT', 'lease contract'],
      ['BREACH', 'breach of contract'],
    ]);
    const modules = hits.map((h) => h.suggestedModuleTemplateId);
    expect(modules.filter((m) => m === 'LEGAL').length).toBe(2);
  });

  it('uppercases entity types', () => {
    const lower = evaluateNerEntities([['compliance', 'tax']]);
    const upper = evaluateNerEntities([['COMPLIANCE', 'tax']]);
    expect(lower.length).toBe(upper.length);
  });

  it('skips malformed entries', () => {
    const hits = evaluateNerEntities([
      [] as unknown as readonly [string, string],
      ['', ''] as readonly [string, string],
      ['COMPLIANCE', 'tax'],
    ]);
    expect(hits).toHaveLength(1);
  });
});

describe('evaluateIntentLabel', () => {
  it('returns empty for empty intent', () => {
    expect(evaluateIntentLabel('')).toEqual([]);
    expect(evaluateIntentLabel(undefined)).toEqual([]);
  });

  it('matches a known intent', () => {
    const hits = evaluateIntentLabel('compliance_query');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.suggestedModuleTemplateId).toBe('COMPLIANCE');
  });

  it('is case-insensitive', () => {
    const hits = evaluateIntentLabel('Compliance_Query');
    expect(hits).toHaveLength(1);
  });

  it('returns empty for unknown intent', () => {
    expect(evaluateIntentLabel('weather_query')).toEqual([]);
  });
});

describe('evaluateDocType', () => {
  it('matches compliance docs with high weight', () => {
    const hits = evaluateDocType('compliance_certificate');
    expect(hits[0]?.suggestedModuleTemplateId).toBe('COMPLIANCE');
    expect(hits[0]?.weight).toBeGreaterThanOrEqual(2);
  });

  it('matches legal docs', () => {
    const hits = evaluateDocType('contract');
    expect(hits[0]?.suggestedModuleTemplateId).toBe('LEGAL');
  });

  it('matches procurement docs', () => {
    const hits = evaluateDocType('purchase_order');
    expect(hits[0]?.suggestedModuleTemplateId).toBe('PROCUREMENT');
  });

  it('returns empty for unknown doc types', () => {
    expect(evaluateDocType('random_doc')).toEqual([]);
  });

  it('handles empty input', () => {
    expect(evaluateDocType('')).toEqual([]);
    expect(evaluateDocType(undefined as unknown as string)).toEqual([]);
  });
});

describe('evaluateTabEventPattern', () => {
  it('matches a known pattern', () => {
    const hits = evaluateTabEventPattern('finance_visits_no_action');
    expect(hits[0]?.suggestedModuleTemplateId).toBe('STRATEGY');
  });

  it('returns empty for unknown pattern', () => {
    expect(evaluateTabEventPattern('unknown_pattern')).toEqual([]);
  });

  it('handles empty input', () => {
    expect(evaluateTabEventPattern('')).toEqual([]);
  });
});

describe('evaluateExternalTrigger', () => {
  it('matches a KRA compliance trigger', () => {
    const hits = evaluateExternalTrigger('kra', 'compliance_notice');
    expect(hits[0]?.suggestedModuleTemplateId).toBe('COMPLIANCE');
    expect(hits[0]?.weight).toBeGreaterThanOrEqual(3);
  });

  it('matches case-insensitively', () => {
    const hits = evaluateExternalTrigger('KRA', 'COMPLIANCE_NOTICE');
    expect(hits[0]?.suggestedModuleTemplateId).toBe('COMPLIANCE');
  });

  it('returns empty for unknown source/kind combo', () => {
    expect(evaluateExternalTrigger('unknown', 'event')).toEqual([]);
    expect(evaluateExternalTrigger('', '')).toEqual([]);
  });
});

describe('defaultWeightForKind', () => {
  it('returns sensible defaults', () => {
    expect(defaultWeightForKind('doc_upload')).toBeGreaterThan(0);
    expect(defaultWeightForKind('search_keyword')).toBeGreaterThan(0);
    expect(defaultWeightForKind('conversation_intent')).toBeGreaterThan(0);
    expect(defaultWeightForKind('tab_event_pattern')).toBeGreaterThan(0);
    expect(defaultWeightForKind('external_trigger')).toBeGreaterThan(0);
  });

  it('returns 0 for unknown kinds', () => {
    expect(defaultWeightForKind('unknown' as never)).toBe(0);
  });
});
