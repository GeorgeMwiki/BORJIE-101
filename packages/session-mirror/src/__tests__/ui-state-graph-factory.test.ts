/**
 * ui-state-graph-factory tests — server-side snapshot reader for
 * Tier III.
 */

import { describe, expect, it } from 'vitest';
import {
  emptyGraph,
  readUiStateGraph,
} from '../snapshot-reader/ui-state-graph-factory.js';
import type { UiStateGraph } from '../types.js';

describe('readUiStateGraph', () => {
  it('returns the latest stored graph', async () => {
    const stored: UiStateGraph = {
      activeTabId: 'tab_buyer_kyb_1',
      tabs: [
        {
          id: 'tab_buyer_kyb_1',
          recipeId: 'BuyerKYBStart',
          recipeVersion: 4,
          openedAt: '2026-01-01T00:00:00.000Z',
          isDirty: true,
          isActive: true,
        },
      ],
      activePanelId: 'panel_company_details',
      activeDialogId: null,
      hoverTarget: { tabId: 'tab_buyer_kyb_1', fieldId: 'company_name', elementRole: 'textbox' },
      scrollPosition: { tabId: 'tab_buyer_kyb_1', y: 240 },
      lastUserEvent: { kind: 'keypress', ts: '2026-01-01T00:00:05.000Z' },
    };
    const result = await readUiStateGraph({
      sessionId: 'sess_1',
      store: {
        latestForSession: async () => stored,
      },
    });
    expect(result).toEqual(stored);
  });

  it('falls back to emptyGraph when the store has nothing', async () => {
    const result = await readUiStateGraph({
      sessionId: 'sess_new',
      store: {
        latestForSession: async () => null,
      },
    });
    expect(result).toEqual(emptyGraph());
  });

  it('emptyGraph has every UI field null + tabs empty', () => {
    const g = emptyGraph();
    expect(g.activeTabId).toBeNull();
    expect(g.activePanelId).toBeNull();
    expect(g.activeDialogId).toBeNull();
    expect(g.hoverTarget).toBeNull();
    expect(g.scrollPosition).toBeNull();
    expect(g.lastUserEvent).toBeNull();
    expect(g.tabs).toEqual([]);
  });
});
