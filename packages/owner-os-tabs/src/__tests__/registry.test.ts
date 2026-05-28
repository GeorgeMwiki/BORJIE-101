import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';

import {
  __resetRegistryForTests,
  buildTabId,
  defaultTabId,
  extractSpawnTabs,
  getTab,
  listSpawnableTabs,
  listTabs,
  matchIntent,
  ownerOsTabContextSchema,
  registerTab,
  topIntent,
  validateContext,
  type OwnerOSTabDescriptor,
} from '../index.js';

function makeDescriptor(
  partial: Partial<OwnerOSTabDescriptor> & Pick<OwnerOSTabDescriptor, 'type'>,
): OwnerOSTabDescriptor {
  return {
    type: partial.type,
    labelEn: partial.labelEn ?? `Label ${partial.type}`,
    labelSw: partial.labelSw ?? `Label ${partial.type} (sw)`,
    descriptionEn: partial.descriptionEn ?? 'description en',
    descriptionSw: partial.descriptionSw ?? 'maelezo',
    iconName: partial.iconName ?? 'Activity',
    color: partial.color ?? 'navy',
    contextSchema: partial.contextSchema ?? ownerOsTabContextSchema,
    intentMatchers: partial.intentMatchers ?? { keywords: [] },
    suggestedTools: partial.suggestedTools ?? [],
    briefSlices: partial.briefSlices ?? [],
    rendererId: partial.rendererId ?? `panel:${partial.type}`,
    pinnedByDefault: partial.pinnedByDefault,
    hiddenFromSpawnMenu: partial.hiddenFromSpawnMenu,
    buildTabId: partial.buildTabId,
  };
}

describe('registry', () => {
  beforeEach(() => {
    __resetRegistryForTests();
  });

  it('registers and looks up by type', () => {
    const d = makeDescriptor({ type: 'hr' });
    registerTab(d);
    expect(getTab('hr')).toBe(d);
  });

  it('listTabs returns descriptors in union order', () => {
    registerTab(makeDescriptor({ type: 'finance' }));
    registerTab(makeDescriptor({ type: 'hr' }));
    registerTab(makeDescriptor({ type: 'compliance' }));
    const types = listTabs().map((d) => d.type);
    // hr comes before finance in the union (per OWNER_OS_TAB_TYPES order).
    expect(types.indexOf('hr')).toBeLessThan(types.indexOf('finance'));
    expect(types.indexOf('finance')).toBeLessThan(types.indexOf('compliance'));
  });

  it('listSpawnableTabs filters hidden descriptors', () => {
    registerTab(makeDescriptor({ type: 'hr' }));
    registerTab(makeDescriptor({ type: 'doc-context', hiddenFromSpawnMenu: true }));
    const types = listSpawnableTabs().map((d) => d.type);
    expect(types).toContain('hr');
    expect(types).not.toContain('doc-context');
  });

  it('throws on unknown tab type', () => {
    expect(() =>
      registerTab(makeDescriptor({ type: 'xyz-not-a-tab' as never })),
    ).toThrow(/Unknown tab type/);
  });

  it('defaultTabId is deterministic per context', () => {
    const a = defaultTabId('compliance', { focus: 'NEMC EIA Geita' });
    const b = defaultTabId('compliance', { focus: 'NEMC EIA Geita' });
    expect(a).toBe(b);
    expect(a).toContain('focus:nemc-eia-geita');
  });

  it('buildTabId honours descriptor buildTabId override', () => {
    const d = makeDescriptor({
      type: 'hr',
      buildTabId: (ctx) => `custom:${ctx.siteId ?? 'none'}`,
    });
    registerTab(d);
    expect(buildTabId(d, { siteId: 'GEITA-001' })).toBe('custom:GEITA-001');
  });

  it('validateContext returns ok=false for invalid input', () => {
    const d = makeDescriptor({ type: 'hr' });
    registerTab(d);
    const r = validateContext(d, { siteId: 123 });
    expect(r.ok).toBe(false);
  });
});

describe('intent-matcher', () => {
  beforeEach(() => {
    __resetRegistryForTests();
    registerTab(
      makeDescriptor({
        type: 'compliance',
        intentMatchers: {
          keywords: ['nemc', 'eia', 'compliance', 'audit'],
          comboBoost: [{ phrases: ['compliance', 'nemc'], boost: 0.2 }],
        },
      }),
    );
    registerTab(
      makeDescriptor({
        type: 'hr',
        intentMatchers: {
          keywords: ['payroll', 'shift', 'attendance', 'hire', 'fire', 'employee'],
        },
      }),
    );
    registerTab(
      makeDescriptor({
        type: 'risk',
        intentMatchers: {
          keywords: ['exposure', 'incident', 'fraud', 'kill switch'],
        },
      }),
    );
  });

  it('ranks compliance highest for an NEMC question', () => {
    const ranked = matchIntent({
      userMessage: 'What is my NEMC compliance status?',
    });
    expect(ranked[0]?.descriptor.type).toBe('compliance');
  });

  it('ranks hr highest for a payroll question', () => {
    const ranked = matchIntent({
      userMessage: 'Show me the payroll for the new hire',
    });
    expect(ranked[0]?.descriptor.type).toBe('hr');
  });

  it('topIntent returns null below threshold', () => {
    const top = topIntent({ userMessage: 'hello world' }, { threshold: 0.4 });
    expect(top).toBeNull();
  });

  it('filter query falls back to substring scan', () => {
    const ranked = matchIntent({ filterQuery: 'risk' });
    expect(ranked[0]?.descriptor.type).toBe('risk');
  });
});

describe('spawn-extractor', () => {
  it('extracts a valid <spawn_tabs> block and strips it from body', () => {
    const raw =
      'Hello\n<spawn_tabs>{"tabs":[{"type":"compliance","context":{"focus":"NEMC"},"reason":"Due in 12 days"}]}</spawn_tabs>\nbye';
    const { body, batch } = extractSpawnTabs(raw);
    expect(body).not.toContain('<spawn_tabs>');
    expect(batch.tabs).toHaveLength(1);
    expect(batch.tabs[0]?.type).toBe('compliance');
    expect(batch.tabs[0]?.reason).toBe('Due in 12 days');
  });

  it('returns an empty batch when no tag is present', () => {
    const { batch } = extractSpawnTabs('plain text');
    expect(batch.tabs).toHaveLength(0);
  });

  it('drops invalid tab types from the salvage path', () => {
    const raw =
      '<spawn_tabs>{"tabs":[{"type":"madeup","context":{},"reason":"x"},{"type":"hr","context":{},"reason":"valid"}]}</spawn_tabs>';
    const { batch } = extractSpawnTabs(raw);
    expect(batch.tabs.map((t) => t.type)).toEqual(['hr']);
  });

  it('caps at 3 candidates per turn', () => {
    const tabs = Array.from({ length: 6 }).map(() => ({
      type: 'hr',
      context: {},
      reason: 'r',
    }));
    const raw = `<spawn_tabs>${JSON.stringify({ tabs })}</spawn_tabs>`;
    const { batch } = extractSpawnTabs(raw);
    expect(batch.tabs.length).toBeLessThanOrEqual(3);
  });
});

describe('context schema extension', () => {
  it('panels can extend the shared context schema', () => {
    const extended = ownerOsTabContextSchema.extend({
      drillHoleId: z.string().min(1),
    });
    const parsed = extended.safeParse({ drillHoleId: 'DH-001' });
    expect(parsed.success).toBe(true);
  });
});
