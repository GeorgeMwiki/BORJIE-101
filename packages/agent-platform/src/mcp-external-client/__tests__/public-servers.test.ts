/**
 * Catalog shape tests.
 *
 * Spec invariants (Docs/DESIGN/MCP_EXTERNAL_CLIENT_SPEC.md §3):
 *   - ≥ 12 entries
 *   - unique ids
 *   - non-empty displayName + packageName
 *   - every transport is one of {stdio, sse, http}
 *   - every auth mode is one of {none, api_key, oauth_token, oauth_pkce}
 *   - tier is 0 | 1 | 2
 */
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_MCP_CATALOG,
  findCatalogEntry,
  isCatalogWellFormed,
} from '../catalog/public-servers.js';

describe('PUBLIC_MCP_CATALOG', () => {
  it('contains at least 12 entries', () => {
    expect(PUBLIC_MCP_CATALOG.length).toBeGreaterThanOrEqual(12);
  });

  it('has unique ids', () => {
    const ids = PUBLIC_MCP_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has non-empty displayName and packageName for every entry', () => {
    for (const entry of PUBLIC_MCP_CATALOG) {
      expect(entry.displayName.length).toBeGreaterThan(0);
      expect(entry.packageName.length).toBeGreaterThan(0);
    }
  });

  it('uses only known transport kinds', () => {
    const allowed = new Set(['stdio', 'sse', 'http']);
    for (const entry of PUBLIC_MCP_CATALOG) {
      expect(allowed.has(entry.transport)).toBe(true);
    }
  });

  it('uses only known auth modes', () => {
    const allowed = new Set(['none', 'api_key', 'oauth_token', 'oauth_pkce']);
    for (const entry of PUBLIC_MCP_CATALOG) {
      expect(allowed.has(entry.auth)).toBe(true);
    }
  });

  it('uses only tier values 0, 1, or 2', () => {
    for (const entry of PUBLIC_MCP_CATALOG) {
      expect([0, 1, 2]).toContain(entry.maxTier);
    }
  });

  it('isCatalogWellFormed returns true', () => {
    expect(isCatalogWellFormed()).toBe(true);
  });

  it('findCatalogEntry returns the slack entry by id', () => {
    const slack = findCatalogEntry('slack');
    expect(slack?.displayName).toBe('Slack');
  });

  it('findCatalogEntry returns undefined for unknown ids', () => {
    expect(findCatalogEntry('does-not-exist')).toBeUndefined();
  });

  it('includes the founder-mandated 12 servers', () => {
    const ids = new Set(PUBLIC_MCP_CATALOG.map((e) => e.id));
    for (const required of [
      'slack',
      'github',
      'google-drive',
      'postgres',
      'filesystem',
      'puppeteer',
      'memory',
      'sequential-thinking',
      'notion',
      'cloudflare',
      'stripe',
      'linear',
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });
});
