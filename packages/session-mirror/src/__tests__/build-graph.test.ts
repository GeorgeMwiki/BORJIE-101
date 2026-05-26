/**
 * build-graph.test — pure translator from beacon-args to UiStateGraph.
 */

import { describe, expect, it } from 'vitest';
import { buildGraph } from '../ui-beacon/build-graph.js';

describe('buildGraph', () => {
  it('passes every arg through to the graph shape', () => {
    const tabs = [
      {
        id: 'tab_1',
        recipeId: 'BuyerKYBStart',
        recipeVersion: 4,
        openedAt: '2026-01-01T00:00:00.000Z',
        isDirty: true,
        isActive: true,
      },
    ];
    const graph = buildGraph({
      tabs,
      activeTabId: 'tab_1',
      activePanelId: 'panel_a',
      activeDialogId: null,
      hoverTarget: { tabId: 'tab_1', fieldId: 'fname', elementRole: 'textbox' },
      scrollPosition: { tabId: 'tab_1', y: 120 },
      lastUserEvent: { kind: 'click', ts: '2026-01-01T00:00:01.000Z' },
    });
    expect(graph.activeTabId).toBe('tab_1');
    expect(graph.tabs).toBe(tabs);
    expect(graph.activePanelId).toBe('panel_a');
    expect(graph.activeDialogId).toBeNull();
    expect(graph.hoverTarget?.fieldId).toBe('fname');
    expect(graph.scrollPosition?.y).toBe(120);
    expect(graph.lastUserEvent?.kind).toBe('click');
  });

  it('preserves nulls verbatim — never coerces to undefined', () => {
    const graph = buildGraph({
      tabs: [],
      activeTabId: null,
      activePanelId: null,
      activeDialogId: null,
      hoverTarget: null,
      scrollPosition: null,
      lastUserEvent: null,
    });
    expect(graph.activeTabId).toBeNull();
    expect(graph.activePanelId).toBeNull();
    expect(graph.activeDialogId).toBeNull();
    expect(graph.hoverTarget).toBeNull();
    expect(graph.scrollPosition).toBeNull();
    expect(graph.lastUserEvent).toBeNull();
  });
});
