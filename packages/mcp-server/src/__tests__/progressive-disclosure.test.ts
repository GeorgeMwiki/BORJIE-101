/**
 * Progressive-disclosure view over the deployable Borjie tool registry.
 *
 * Proves the deployable surface participates in tools-as-/proc-filesystem:
 * a cheap name catalogue (ls) + a per-tool full-spec describe (cat), with
 * tier-scoped listing so a caller never sees names above its tier.
 */

import { describe, it, expect } from 'vitest';
import { BORJIE_TOOLS } from '../tool-registry.js';
import {
  listToolCatalog,
  describeTools,
} from '../progressive-disclosure.js';

describe('listToolCatalog (ls)', () => {
  it('lists every tool as name + gating metadata, no schema', () => {
    const catalog = listToolCatalog();
    expect(catalog.length).toBe(BORJIE_TOOLS.length);
    for (const e of catalog) {
      expect(e).toHaveProperty('name');
      expect(e).toHaveProperty('minimumTier');
      expect(e).toHaveProperty('requiredScopes');
      // names-only view never carries the heavy input schema
      expect(e).not.toHaveProperty('inputSchema');
      expect(e).not.toHaveProperty('description');
    }
  });

  it('scopes the catalogue to a tier ceiling', () => {
    const standardOnly = listToolCatalog({ maxTier: 'standard' });
    expect(standardOnly.every((e) => e.minimumTier === 'standard')).toBe(true);
    const upToPro = listToolCatalog({ maxTier: 'pro' });
    expect(upToPro.every((e) => e.minimumTier !== 'enterprise')).toBe(true);
    // enterprise ceiling sees everything
    expect(listToolCatalog({ maxTier: 'enterprise' }).length).toBe(
      BORJIE_TOOLS.length,
    );
    expect(upToPro.length).toBeGreaterThanOrEqual(standardOnly.length);
  });
});

describe('describeTools (cat)', () => {
  it('pages in the FULL spec for only the requested names', () => {
    const specs = describeTools(['query_property_graph', 'run_skill']);
    expect(specs.length).toBe(2);
    for (const s of specs) {
      expect(s.inputSchema).toBeTypeOf('object');
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.requiredInputs).toBeDefined();
    }
    expect(specs.map((s) => s.name).sort()).toEqual([
      'query_property_graph',
      'run_skill',
    ]);
  });

  it('silently skips unknown names', () => {
    const specs = describeTools(['query_property_graph', 'ghost_tool']);
    expect(specs.map((s) => s.name)).toEqual(['query_property_graph']);
    expect(describeTools([])).toEqual([]);
  });
});
