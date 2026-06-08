/**
 * Mount manifest — service-as-organ declaration + progressive disclosure.
 *
 * Proves this public service advertises itself in a registry-ready shape and
 * participates in tools-as-/proc-filesystem: a cheap name catalogue (ls) and
 * a per-tool full-spec describe (cat) over its public tool catalog.
 */

import { describe, it, expect } from 'vitest';
import { BORJIE_PUBLIC_MCP_TOOLS } from '../tool-catalog.js';
import {
  MOUNT_SERVICE_ID,
  buildMountServiceDescriptor,
  listMountToolCatalog,
  describeMountTools,
} from '../mount-manifest.js';

describe('buildMountServiceDescriptor', () => {
  it('declares this service as a mountable organ with a parity edge', () => {
    const d = buildMountServiceDescriptor({
      publicBaseUrl: 'https://mcp.borjie.app',
    });
    expect(d.id).toBe(MOUNT_SERVICE_ID);
    // namespacing-safe id (consumer namespaces tool paths off this)
    expect(/^[a-zA-Z0-9_-]+$/.test(d.id)).toBe(true);
    expect(d.project).toBe('borjie');
    expect(d.kind).toBe('gateway');
    expect(d.mirrors).toBe('bn-public-mcp');
    expect(d.transports).toContain('stdio');
    expect(d.protocolVersion).toBe('2024-11-05');
    expect(d.toolCount).toBe(BORJIE_PUBLIC_MCP_TOOLS.length);
  });
});

describe('listMountToolCatalog (ls)', () => {
  it('lists names + gating metadata only, no input schemas', () => {
    const catalog = listMountToolCatalog();
    expect(catalog.length).toBe(BORJIE_PUBLIC_MCP_TOOLS.length);
    for (const e of catalog) {
      expect(e).toHaveProperty('name');
      expect(e).toHaveProperty('stakes');
      expect(e).toHaveProperty('requiredScopes');
      expect(e).not.toHaveProperty('inputSchema');
      expect(e).not.toHaveProperty('description');
    }
  });

  it('filters reads-only and writes-only', () => {
    const reads = listMountToolCatalog({ readsOnly: true });
    expect(reads.every((e) => e.isWrite === false)).toBe(true);
    const writes = listMountToolCatalog({ writesOnly: true });
    expect(writes.every((e) => e.isWrite === true)).toBe(true);
    expect(reads.length + writes.length).toBe(BORJIE_PUBLIC_MCP_TOOLS.length);
  });
});

describe('describeMountTools (cat)', () => {
  it('pages in the FULL spec for only the requested names', () => {
    const specs = describeMountTools(['mining_drafts_list', 'mining_ui_tabs_spawn']);
    expect(specs.length).toBe(2);
    for (const s of specs) {
      expect(s.inputSchema.type).toBe('object');
      expect(s.description.length).toBeGreaterThan(0);
      expect(s).toHaveProperty('requiresConfirmation');
    }
    expect(specs.map((s) => s.name).sort()).toEqual([
      'mining_drafts_list',
      'mining_ui_tabs_spawn',
    ]);
  });

  it('silently skips unknown names', () => {
    const specs = describeMountTools(['mining_drafts_list', 'ghost']);
    expect(specs.map((s) => s.name)).toEqual(['mining_drafts_list']);
    expect(describeMountTools([])).toEqual([]);
  });
});
