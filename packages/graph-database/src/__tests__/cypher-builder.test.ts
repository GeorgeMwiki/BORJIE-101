/**
 * CypherBuilder tests — covers tenant invariant + clause emission.
 */
import { describe, expect, it } from 'vitest';
import { cypher, CypherBuilder } from '../query/cypher-builder.js';
import { GraphDatabaseError } from '../types.js';

describe('CypherBuilder', () => {
  it('rejects build() when .tenant() was not called', () => {
    const builder = cypher();
    expect(() => builder.build()).toThrow(GraphDatabaseError);
    expect(() => builder.build()).toThrow(/tenant/i);
  });

  it('rejects MATCH issued before .tenant()', () => {
    const builder = new CypherBuilder();
    expect(() =>
      builder.match({ variable: 'm', labels: ['Mine'], properties: {} }),
    ).toThrow(GraphDatabaseError);
  });

  it('rejects empty tenantId', () => {
    expect(() => cypher().tenant('')).toThrow(GraphDatabaseError);
    expect(() => cypher().tenant('   ')).toThrow(GraphDatabaseError);
  });

  it('emits MATCH with tenant predicate', () => {
    const query = cypher()
      .tenant('tnt-1')
      .match({ variable: 'm', labels: ['Mine'], properties: {} })
      .return('m')
      .build();
    expect(query.cypher).toContain('MATCH (m:Mine');
    expect(query.cypher).toContain('tenantId: $tenantId');
    expect(query.cypher).toContain('RETURN m');
    expect(query.params['tenantId']).toBe('tnt-1');
    expect(query.tenantScoped).toBe(true);
    expect(query.readOnly).toBe(true);
  });

  it('marks query as write when MERGE/CREATE/SET/DELETE used', () => {
    const merged = cypher()
      .tenant('tnt-1')
      .merge({ variable: 'm', labels: ['Mine'], properties: { id: '$id' } })
      .return('m')
      .build();
    expect(merged.readOnly).toBe(false);

    const set = cypher()
      .tenant('tnt-1')
      .match({ variable: 'm', labels: ['Mine'], properties: {} })
      .set('m.name = $name')
      .return('m')
      .build();
    expect(set.readOnly).toBe(false);
  });

  it('emits relationship arrows with direction', () => {
    const query = cypher()
      .tenant('tnt-1')
      .match({ variable: 'a', labels: ['A'], properties: {} })
      .matchRel({
        fromVariable: 'a',
        toVariable: 'b',
        type: 'REL',
        direction: 'out',
        properties: {},
      })
      .match({ variable: 'b', labels: ['B'], properties: {} })
      .return('a, b')
      .build();
    expect(query.cypher).toContain('-[:REL]->');
  });

  it('enforces param() rules', () => {
    expect(() => cypher().tenant('tnt-1').param('', 1)).toThrow(
      GraphDatabaseError,
    );
    expect(() => cypher().tenant('tnt-1').param('$bad', 1)).toThrow(
      GraphDatabaseError,
    );
    const ok = cypher().tenant('tnt-1').param('age', 30);
    expect(ok).toBeInstanceOf(CypherBuilder);
  });

  it('rejects empty-clause builds', () => {
    expect(() => cypher().tenant('tnt-1').build()).toThrow(GraphDatabaseError);
  });

  it('rejects negative/zero limit', () => {
    expect(() =>
      cypher()
        .tenant('tnt-1')
        .match({ variable: 'm', labels: ['Mine'], properties: {} })
        .return('m')
        .limit(0),
    ).toThrow(GraphDatabaseError);
    expect(() =>
      cypher()
        .tenant('tnt-1')
        .match({ variable: 'm', labels: ['Mine'], properties: {} })
        .return('m')
        .limit(-3),
    ).toThrow(GraphDatabaseError);
  });

  it('is immutable — every chain returns a fresh builder', () => {
    const root = cypher().tenant('tnt-1');
    const branchA = root.match({
      variable: 'a',
      labels: ['A'],
      properties: {},
    });
    const branchB = root.match({
      variable: 'b',
      labels: ['B'],
      properties: {},
    });
    expect(branchA).not.toBe(branchB);
    expect(branchA).not.toBe(root);
  });
});
