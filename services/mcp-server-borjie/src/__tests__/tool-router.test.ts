import { describe, it, expect } from 'vitest';
import {
  substitutePath,
  shapeRequest,
  TOOL_ROUTE_MAP,
} from '../tool-router.js';

describe('substitutePath', () => {
  it('substitutes a single param', () => {
    expect(substitutePath('/x/{id}', { id: '42' })).toBe('/x/42');
  });
  it('throws when missing', () => {
    expect(() => substitutePath('/x/{id}', {})).toThrow();
  });
  it('url-encodes', () => {
    expect(substitutePath('/x/{id}', { id: 'a b' })).toBe('/x/a%20b');
  });
});

describe('shapeRequest', () => {
  it('picks body keys', () => {
    const r = TOOL_ROUTE_MAP['decisions_create'];
    if (!r) throw new Error('route missing');
    const shaped = shapeRequest(r, {
      title: 't',
      rationale: 'r',
      extra: 'should-drop',
    });
    expect(shaped.body).toEqual({ title: 't', rationale: 'r' });
  });
  it('picks query keys', () => {
    const r = TOOL_ROUTE_MAP['decisions_list'];
    if (!r) throw new Error('route missing');
    const shaped = shapeRequest(r, { since: '2026-05-29', limit: 10 });
    expect(shaped.query).toEqual({ since: '2026-05-29', limit: 10 });
  });
  it('returns undefined when no keys provided', () => {
    const r = TOOL_ROUTE_MAP['decisions_create'];
    if (!r) throw new Error('route missing');
    expect(shapeRequest(r, {}).body).toBeUndefined();
  });
});

describe('TOOL_ROUTE_MAP coverage', () => {
  it('has a route for every public tool', () => {
    // Imported here to avoid circulars in the dispatcher test.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cat = require('../tool-catalog.js') as {
      BORJIE_PUBLIC_MCP_TOOLS: Array<{ name: string }>;
    };
    for (const t of cat.BORJIE_PUBLIC_MCP_TOOLS) {
      expect(TOOL_ROUTE_MAP[t.name]).toBeDefined();
    }
  });
});
