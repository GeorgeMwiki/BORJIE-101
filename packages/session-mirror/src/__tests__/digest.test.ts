/**
 * digest.test — UI-state digest is the hot-path equality check the
 * beacon uses to skip redundant publications. The contract:
 *
 *   - Same shape -> same digest (stable across renders).
 *   - Different active tab, different scroll, different hover -> different digest.
 *   - Null fields collapse to empty markers, never to "undefined".
 */

import { describe, expect, it } from 'vitest';
import { digestOf } from '../ui-beacon/digest.js';
import { emptyGraph } from '../snapshot-reader/ui-state-graph-factory.js';
import type { UiStateGraph } from '../types.js';

const baseGraph: UiStateGraph = {
  activeTabId: 'tab_1',
  tabs: [
    {
      id: 'tab_1',
      recipeId: 'BuyerKYBStart',
      recipeVersion: 4,
      openedAt: '2026-01-01T00:00:00.000Z',
      isDirty: true,
      isActive: true,
    },
    {
      id: 'tab_2',
      recipeId: 'ParcelDetail',
      recipeVersion: 7,
      openedAt: '2026-01-01T00:00:05.000Z',
      isDirty: false,
      isActive: false,
    },
  ],
  activePanelId: 'panel_company_details',
  activeDialogId: null,
  hoverTarget: { tabId: 'tab_1', fieldId: 'company_name', elementRole: 'textbox' },
  scrollPosition: { tabId: 'tab_1', y: 240 },
  lastUserEvent: { kind: 'keypress', ts: '2026-01-01T00:00:10.000Z' },
};

describe('digestOf', () => {
  it('is deterministic for the same shape', () => {
    expect(digestOf(baseGraph)).toBe(digestOf(baseGraph));
  });

  it('changes when activeTabId changes', () => {
    const a = digestOf(baseGraph);
    const b = digestOf({ ...baseGraph, activeTabId: 'tab_2' });
    expect(a).not.toBe(b);
  });

  it('changes when a tab becomes dirty', () => {
    const a = digestOf(baseGraph);
    const b = digestOf({
      ...baseGraph,
      tabs: [
        { ...baseGraph.tabs[0]!, isDirty: false },
        ...baseGraph.tabs.slice(1),
      ],
    });
    expect(a).not.toBe(b);
  });

  it('changes when the hover target moves', () => {
    const a = digestOf(baseGraph);
    const b = digestOf({
      ...baseGraph,
      hoverTarget: { tabId: 'tab_2', fieldId: null, elementRole: null },
    });
    expect(a).not.toBe(b);
  });

  it('changes when scroll y changes', () => {
    const a = digestOf(baseGraph);
    const b = digestOf({
      ...baseGraph,
      scrollPosition: { tabId: 'tab_1', y: 999 },
    });
    expect(a).not.toBe(b);
  });

  it('handles the empty-graph shape without crashing', () => {
    expect(digestOf(emptyGraph())).toBe(
      'at:|pa:|di:|tabs:|hov:|scr:|evt:',
    );
  });
});
