/**
 * Provenance tests — PROV-O attach + validate.
 */
import { describe, expect, it } from 'vitest';
import {
  attachProvenance,
  hasProvenance,
  validateProvenance,
} from '../provenance/index.js';
import { TENANT, makeEdge, makeNode } from './fixtures.js';
import type { ProvenanceRecord } from '../types.js';

const goodProv: ProvenanceRecord = {
  activityKind: 'ingest',
  sourceUri: 'pg://leases/123',
  capturedAt: '2025-01-01T00:00:00Z',
};

describe('attachProvenance', () => {
  it('returns a new node with derivedFrom set', () => {
    const n = makeNode({ id: 'p1', class: 'Property' });
    const updated = attachProvenance(n, goodProv);
    expect(updated.derivedFrom).toEqual(goodProv);
    // Immutability
    expect(n.derivedFrom).toBeUndefined();
  });

  it('returns a new edge with derivedFrom set', () => {
    const e = makeEdge({ id: 'e1', fromId: 'a', toId: 'b', label: 'rel' });
    const updated = attachProvenance(e, goodProv);
    expect(updated.derivedFrom).toEqual(goodProv);
    expect(e.derivedFrom).toBeUndefined();
  });
});

describe('hasProvenance', () => {
  it('detects presence vs absence', () => {
    const n = makeNode({ id: 'p1', class: 'Property' });
    expect(hasProvenance(n)).toBe(false);
    const withProv = attachProvenance(n, goodProv);
    expect(hasProvenance(withProv)).toBe(true);
  });
});

describe('validateProvenance', () => {
  it('reports missing provenance only when strict=true', () => {
    const n = makeNode({ id: 'p1', class: 'Property' });
    const looseResult = validateProvenance({ nodes: [n], edges: [], strict: false });
    expect(looseResult.valid).toBe(true);
    expect(looseResult.missingIds).toEqual([]);
    const strictResult = validateProvenance({ nodes: [n], edges: [], strict: true });
    expect(strictResult.valid).toBe(false);
    expect(strictResult.missingIds).toEqual(['p1']);
  });

  it('detects malformed provenance records', () => {
    const malformedRecord = {
      activityKind: 'NOT_A_KIND',
      sourceUri: 'x',
      capturedAt: 'y',
    } as unknown as ProvenanceRecord;
    const n = attachProvenance(makeNode({ id: 'p1', class: 'Property' }), malformedRecord);
    const result = validateProvenance({ nodes: [n], edges: [] });
    expect(result.valid).toBe(false);
    expect(result.malformedIds).toContain('p1');
  });

  it('valid when both nodes and edges have well-formed provenance', () => {
    const n = attachProvenance(makeNode({ id: 'p1', class: 'Property' }), goodProv);
    const e = attachProvenance(
      makeEdge({ id: 'e1', fromId: 'p1', toId: 'p1', label: 'self' }),
      { ...goodProv, activityKind: 'extract' },
    );
    const result = validateProvenance({ nodes: [n], edges: [e], strict: true });
    expect(result.valid).toBe(true);
  });

  it('includes optional bindings — c2paSignatureId, aiModelId, citationBundleId', () => {
    const fullProv: ProvenanceRecord = {
      ...goodProv,
      c2paSignatureId: 'c2pa-sig-abc',
      aiModelId: 'claude-opus-4-7',
      citationBundleId: 'cite-bundle-xyz',
    };
    const n = attachProvenance(makeNode({ id: 'p1', class: 'Property', tenantId: TENANT }), fullProv);
    const result = validateProvenance({ nodes: [n], edges: [], strict: true });
    expect(result.valid).toBe(true);
    expect(n.derivedFrom?.c2paSignatureId).toBe('c2pa-sig-abc');
    expect(n.derivedFrom?.aiModelId).toBe('claude-opus-4-7');
    expect(n.derivedFrom?.citationBundleId).toBe('cite-bundle-xyz');
  });
});
