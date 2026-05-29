import { describe, it, expect } from 'vitest';
import {
  hasRequiredScopes,
  grantableScopesForOwner,
  BORJIE_SCOPE_CATALOG,
} from '../scopes.js';

describe('hasRequiredScopes', () => {
  it('returns true when granted is a superset', () => {
    expect(
      hasRequiredScopes(['owner:read', 'owner:write'], ['owner:read']),
    ).toBe(true);
  });
  it('returns false when missing a required scope', () => {
    expect(hasRequiredScopes(['owner:read'], ['owner:write'])).toBe(false);
  });
  it('returns true for empty required', () => {
    expect(hasRequiredScopes([], [])).toBe(true);
  });
});

describe('grantableScopesForOwner', () => {
  it('excludes admin scopes', () => {
    const g = grantableScopesForOwner();
    expect(g.includes('admin:read' as never)).toBe(false);
    expect(g.includes('owner:read' as never)).toBe(true);
  });
});

describe('BORJIE_SCOPE_CATALOG', () => {
  it('has every scope bilingual', () => {
    for (const s of BORJIE_SCOPE_CATALOG) {
      expect(s.displayNameEn.length).toBeGreaterThan(0);
      expect(s.displayNameSw.length).toBeGreaterThan(0);
      expect(s.descriptionEn.length).toBeGreaterThan(0);
      expect(s.descriptionSw.length).toBeGreaterThan(0);
    }
  });
});
