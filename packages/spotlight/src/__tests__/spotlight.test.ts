import { describe, it, expect } from 'vitest';
import {
  searchSpotlight,
  executeAction,
} from '../spotlight-engine.js';
import { resolveEntities } from '../entity-resolver.js';
import { ACTION_CATALOG, findActionById } from '../action-catalog.js';

describe('spotlight engine', () => {
  it('matches an action by title keyword', () => {
    const results = searchSpotlight(
      { query: 'arrears', userRoles: ['OWNER'] },
      undefined
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title.toLowerCase()).toContain('arrears');
  });

  it('hides actions the user has no role for', () => {
    const results = searchSpotlight(
      { query: 'draft lease', userRoles: ['TENANT'] },
      undefined
    );
    // mutate.lease.draft requires OWNER/MANAGER — should not appear for TENANT.
    expect(results.find((r) => r.id === 'action:mutate.lease.draft')).toBeUndefined();
  });

  it('returns persona handoff when query has zero matches', () => {
    const results = searchSpotlight(
      { query: 'xyzzy unknown', userRoles: ['OWNER'] },
      undefined
    );
    expect(results[0].kind).toBe('persona_handoff');
  });

  it('ranks entity matches when index is provided', () => {
    const results = searchSpotlight(
      { query: 'unit 4B', userRoles: ['OWNER'] },
      {
        units: [
          { id: 'u1', label: '4B', propertyName: 'Goba' },
          { id: 'u2', label: '9C', propertyName: 'Upanga' },
        ],
        properties: [],
        tenants: [],
      }
    );
    const entityHit = results.find((r) => r.kind === 'entity');
    expect(entityHit).toBeDefined();
    expect(entityHit?.entity?.id).toBe('u1');
  });

  it('executes an action only for authorised roles', () => {
    const ok = executeAction('mutate.lease.draft', ['OWNER']);
    expect(ok.ok).toBe(true);
    const denied = executeAction('mutate.lease.draft', ['TENANT']);
    expect(denied.ok).toBe(false);
  });

  it('rejects unknown action ids', () => {
    const r = executeAction('nope', ['OWNER']);
    expect(r.ok).toBe(false);
  });

  it('returns an empty query default list', () => {
    const results = searchSpotlight({ query: '', userRoles: ['OWNER'] });
    expect(results.length).toBeGreaterThan(0);
  });

  it('every catalog entry can be found by id', () => {
    for (const a of ACTION_CATALOG) {
      expect(findActionById(a.id)?.id).toBe(a.id);
    }
  });
});

describe('entity resolver', () => {
  it('resolves unit by explicit reference', () => {
    const matches = resolveEntities('unit 4B at Goba', {
      units: [{ id: 'u1', label: '4B', propertyName: 'Goba' }],
      properties: [],
      tenants: [],
    });
    expect(matches[0]?.id).toBe('u1');
  });

  it('resolves tenant by full name', () => {
    const matches = resolveEntities('jane mwangi', {
      units: [],
      properties: [],
      tenants: [{ id: 't1', name: 'Jane Mwangi' }],
    });
    expect(matches[0]?.id).toBe('t1');
  });

  it('returns empty array for irrelevant query', () => {
    const matches = resolveEntities('xyzzy', {
      units: [{ id: 'u1', label: '4B' }],
      properties: [],
      tenants: [],
    });
    expect(matches.length).toBe(0);
  });
});
