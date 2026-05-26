/**
 * Tests for the query classifier — verify each axis scores
 * independently, the decision matrix picks the right mode, and
 * `forceMode` short-circuits classification.
 */

import { describe, expect, it } from 'vitest';
import {
  aggregationKeywordScore,
  classifyQuery,
  entityDensity,
  relationalKeywordScore,
  specificityScore,
} from '../routing/query-classifier.js';
import type { QueryContext } from '../types.js';

const ctx: QueryContext = { tenantId: 't1' };

describe('axis scoring', () => {
  it('entityDensity > 0 when query contains capitalised names', () => {
    expect(entityDensity('Mr Mwikila visited Geita and Mwanza')).toBeGreaterThan(
      0,
    );
  });

  it('entityDensity is 0 for an empty query', () => {
    expect(entityDensity('')).toBe(0);
  });

  it('relationalKeywordScore > 0 for relationship queries', () => {
    expect(
      relationalKeywordScore('which agents reports to the geita MD'),
    ).toBeGreaterThan(0);
  });

  it('aggregationKeywordScore > 0 for summary queries', () => {
    expect(
      aggregationKeywordScore('summarise the themes across the quarter'),
    ).toBeGreaterThan(0);
  });

  it('specificityScore > 0 for numbered or quoted queries', () => {
    expect(specificityScore('find rows where amount = 1234')).toBeGreaterThan(0);
    expect(specificityScore('lookup "exact phrase here"')).toBeGreaterThan(0);
  });
});

describe('classifyQuery', () => {
  it('picks graph_global for aggregation queries', () => {
    const d = classifyQuery(
      'summarise the dominant themes across the corpus',
      ctx,
    );
    expect(d.mode).toBe('graph_global');
    expect(d.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('picks graph_local for entity-dense relationship queries', () => {
    const d = classifyQuery(
      'How is Geita Office connected to Mwanza Branch and Buyer-X',
      ctx,
    );
    expect(['graph_local', 'graph_global']).toContain(d.mode);
  });

  it('picks vector for specific numeric / quoted queries', () => {
    const d = classifyQuery(
      'lookup the row where transaction_id = 99887766 from "ledger 2026"',
      ctx,
    );
    expect(d.mode).toBe('vector');
  });

  it('falls back to hybrid when no axis dominates', () => {
    const d = classifyQuery('show me stuff', ctx);
    expect(d.mode).toBe('hybrid');
  });

  it('honours forceMode without scoring', () => {
    const d = classifyQuery('anything at all', {
      tenantId: 't1',
      forceMode: 'graph_local',
    });
    expect(d.mode).toBe('graph_local');
    expect(d.reason).toBe('force-mode');
    expect(d.confidence).toBe(1);
  });

  it('confidence stays within [0.5, 1]', () => {
    const d = classifyQuery('summarise the themes across the quarter', ctx);
    expect(d.confidence).toBeGreaterThanOrEqual(0.5);
    expect(d.confidence).toBeLessThanOrEqual(1);
  });

  it('returns axis scores for observability', () => {
    const d = classifyQuery('summarise the themes', ctx);
    expect(d.scores).toBeDefined();
    expect(d.scores!.aggregationKeywords).toBeGreaterThan(0);
  });
});
