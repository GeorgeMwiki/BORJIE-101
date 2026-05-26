import { describe, it, expect } from 'vitest';
import { createConnectorRegistry, DEFAULT_REGISTRY_ENTRIES } from '../registry/connector-registry.js';

describe('createConnectorRegistry', () => {
  it('exposes the default entries', () => {
    const reg = createConnectorRegistry();
    expect(reg.all().length).toBe(DEFAULT_REGISTRY_ENTRIES.length);
    expect(reg.all().length).toBeGreaterThan(10);
  });

  it('filters by phase', () => {
    const reg = createConnectorRegistry();
    const p0 = reg.byPhase('P0');
    // OMNIDATA_CONNECTOR_INVENTORY.md names 6 P0 source kinds; some
    // (Gmail / Outlook, Google Cal / Outlook Cal, Drive / OneDrive / Dropbox)
    // are 3 catalogue rows each. The registry holds an entry per row.
    expect(p0.length).toBeGreaterThanOrEqual(6);
    expect(p0.every((e) => e.phase === 'P0')).toBe(true);
  });

  it('looks up by source kind', () => {
    const reg = createConnectorRegistry();
    const slack = reg.byKind('slack');
    expect(slack).toBeDefined();
    expect(slack?.sourceKind).toBe('slack');
  });

  it('returns undefined for an unknown kind lookup', () => {
    // Using a value not in the default entries to confirm undefined.
    const reg = createConnectorRegistry([]);
    expect(reg.byKind('slack')).toBeUndefined();
  });

  it('looks up by id', () => {
    const reg = createConnectorRegistry();
    const entry = reg.byId('slack:default');
    expect(entry).toBeDefined();
    expect(entry?.sourceKind).toBe('slack');
  });

  it('accepts a custom entries list for testing', () => {
    const reg = createConnectorRegistry([
      {
        id: 'custom:1',
        sourceKind: 'notion',
        displayName: 'Notion Custom',
        description: 'A custom Notion connector for testing.',
        phase: 'P0',
        volumeClass: 'light',
        refreshPolicy: { kind: 'on-demand' },
        requiresConsentScope: 'workspace',
        mcpServerOpportunity: 'no',
        authKind: 'oauth2',
      },
    ]);
    expect(reg.all()).toHaveLength(1);
    expect(reg.byId('custom:1')?.displayName).toBe('Notion Custom');
  });

  it('includes the P3 already-shipped TRA / Tumemadini servers', () => {
    const reg = createConnectorRegistry();
    const tra = reg.byKind('tra_portal');
    expect(tra?.mcpServerOpportunity).toBe('already_shipped');
    const tume = reg.byKind('tumemadini_portal');
    expect(tume?.mcpServerOpportunity).toBe('already_shipped');
  });
});
