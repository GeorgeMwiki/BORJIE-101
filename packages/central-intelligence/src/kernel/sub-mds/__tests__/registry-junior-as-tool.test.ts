/**
 * Junior-as-MCP-tool mirror over the sub-MD registry.
 *
 * Proves the mount-everything lane's last acceptance criterion: the registry
 * resolves a junior as an MCP tool, and does so through the same cheap-ls /
 * paged-cat progressive-disclosure shape the services use. Also asserts the
 * existing resolution (`getSubMdFactory`/`hasSubMd`) is untouched.
 */

import { describe, it, expect } from 'vitest';
import {
  REGISTERED_SUB_MD_IDS,
  getSubMdFactory,
  hasSubMd,
  listJuniorToolCatalog,
  resolveJuniorAsTool,
  describeJuniorsAsTools,
} from '../registry.js';

describe('junior-as-tool mirror', () => {
  it('lists every canonical junior as a cheap tool-catalogue entry', () => {
    const catalog = listJuniorToolCatalog();
    // 8 canonical factories ship today
    expect(catalog.length).toBe(8);
    for (const e of catalog) {
      expect(e).toHaveProperty('name');
      expect(e).toHaveProperty('displayName');
      expect(e).toHaveProperty('riskTier');
      // the cheap `ls` view never carries the heavier persona description
      expect(e).not.toHaveProperty('description');
      expect(e).not.toHaveProperty('toolBelt');
    }
    expect(catalog.map((e) => e.name)).toContain('royalty.chaser');
  });

  it('resolves a single junior as a full MCP tool descriptor (the cat)', () => {
    const d = resolveJuniorAsTool('royalty.chaser');
    expect(d).not.toBeNull();
    expect(d?.name).toBe('royalty.chaser');
    expect(d?.displayName).toBe('Borjie Royalty Coordinator');
    expect(d?.description.length).toBeGreaterThan(0);
    expect(d?.toolBelt).toContain('arrears.send_reminder');
    expect(d?.riskTier).toBe('mutate');
  });

  it('resolves hyphen aliases to the canonical junior', () => {
    const viaAlias = resolveJuniorAsTool('tra.filing-assistant');
    const viaCanonical = resolveJuniorAsTool('tra.filing_assistant');
    expect(viaAlias).not.toBeNull();
    expect(viaAlias?.name).toBe('tra.filing_assistant');
    expect(viaAlias).toEqual(viaCanonical);
  });

  it('honest-degrades on an unregistered id', () => {
    expect(resolveJuniorAsTool('inspections.scheduler')).toBeNull();
  });

  it('pages in (cat *) only the requested juniors, skipping unknowns', () => {
    const specs = describeJuniorsAsTools([
      'royalty.chaser',
      'ghost.worker',
      'vendor.onboarding',
    ]);
    expect(specs.map((s) => s.name).sort()).toEqual([
      'royalty.chaser',
      'vendor.onboarding',
    ]);
    expect(describeJuniorsAsTools([])).toEqual([]);
  });

  it('every registered id resolves as a tool (catalogue ⊇ canonical)', () => {
    for (const id of REGISTERED_SUB_MD_IDS) {
      expect(resolveJuniorAsTool(id)).not.toBeNull();
    }
  });

  it('leaves the existing factory resolution untouched', () => {
    // additive guarantee — the original API still behaves
    expect(hasSubMd('royalty.chaser')).toBe(true);
    expect(getSubMdFactory('royalty.chaser')).not.toBeNull();
    expect(getSubMdFactory('inspections.scheduler')).toBeNull();
  });
});
