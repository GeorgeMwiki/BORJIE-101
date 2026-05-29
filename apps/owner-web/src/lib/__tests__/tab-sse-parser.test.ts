/**
 * Owner-web tab SSE parser tests (CT-3).
 */

import { describe, expect, it, vi } from 'vitest';

import type { OwnerTab } from '../owner-tabs-store';
import {
  applyUpdatePatch,
  handleTabSseFrame,
  isTabSseEvent,
  spawnPayloadToTab,
  type TabProposalPayload,
  type TabSpawnPayload,
  type TabUpdatePayload,
} from '../tab-sse-parser';

describe('isTabSseEvent', () => {
  it('recognises every tab event name', () => {
    expect(isTabSseEvent('tab_spawn')).toBe(true);
    expect(isTabSseEvent('tab_update')).toBe(true);
    expect(isTabSseEvent('tab_remove')).toBe(true);
    expect(isTabSseEvent('tab_proposal')).toBe(true);
    expect(isTabSseEvent('tab_tag_error')).toBe(true);
  });
  it('rejects unrelated event names', () => {
    expect(isTabSseEvent('message_chunk')).toBe(false);
    expect(isTabSseEvent('spawn_tabs')).toBe(false);
  });
});

describe('handleTabSseFrame', () => {
  it('dispatches a valid tab_spawn payload to onSpawn', () => {
    const onSpawn = vi.fn();
    const data = JSON.stringify({
      payload: {
        tagKind: 'tab_spawn',
        tabId: 'finance|focus:gold-q1',
        tabType: 'finance',
        title: 'Gold Sales by Region',
        titleSw: 'Mauzo ya Dhahabu kwa Mkoa',
        config: { mineralKind: 'gold', window: 'quarter' },
        droppedKeys: [],
        source: 'brain',
      },
      at: '2026-05-29T12:00:00Z',
    });
    const ok = handleTabSseFrame({
      eventName: 'tab_spawn',
      rawData: data,
      handlers: { onSpawn },
    });
    expect(ok).toBe(true);
    expect(onSpawn).toHaveBeenCalledTimes(1);
    const arg = onSpawn.mock.calls[0]?.[0] as TabSpawnPayload;
    expect(arg.tabType).toBe('finance');
    expect(arg.titleSw).toBe('Mauzo ya Dhahabu kwa Mkoa');
  });

  it('dispatches a valid tab_update payload to onUpdate', () => {
    const onUpdate = vi.fn();
    const data = JSON.stringify({
      payload: {
        tagKind: 'tab_update',
        tabId: 'finance|focus:gold',
        patch: { config: { window: 'week' } },
        source: 'brain',
      },
    });
    const ok = handleTabSseFrame({
      eventName: 'tab_update',
      rawData: data,
      handlers: { onUpdate },
    });
    expect(ok).toBe(true);
    const arg = onUpdate.mock.calls[0]?.[0] as TabUpdatePayload;
    expect(arg.patch.config).toEqual({ window: 'week' });
  });

  it('dispatches a valid tab_proposal payload to onProposal', () => {
    const onProposal = vi.fn();
    const data = JSON.stringify({
      payload: {
        tagKind: 'tab_proposal',
        proposalId: 'brain:t1:u1:1234:finance',
        tabType: 'finance',
        title: 'Pin Mwadui Royalty Tracker',
        titleSw: 'Bandika Kifuatiliaji cha Mwadui',
        reasonEn: 'You drilled in 3 times this week',
        reasonSw: 'Umechunguza mara 3 wiki hii',
        evidenceIds: ['obs-1', 'obs-2', 'obs-3'],
        confidence: 0.85,
        config: { focus: 'Mwadui' },
      },
    });
    const ok = handleTabSseFrame({
      eventName: 'tab_proposal',
      rawData: data,
      handlers: { onProposal },
    });
    expect(ok).toBe(true);
    const arg = onProposal.mock.calls[0]?.[0] as TabProposalPayload;
    expect(arg.evidenceIds).toHaveLength(3);
  });

  it('rejects malformed JSON without throwing', () => {
    const onSpawn = vi.fn();
    const ok = handleTabSseFrame({
      eventName: 'tab_spawn',
      rawData: '{not-json',
      handlers: { onSpawn },
    });
    expect(ok).toBe(false);
    expect(onSpawn).not.toHaveBeenCalled();
  });

  it('rejects unknown event names without dispatch', () => {
    const onSpawn = vi.fn();
    const ok = handleTabSseFrame({
      eventName: 'message_chunk',
      rawData: JSON.stringify({ text: 'hello' }),
      handlers: { onSpawn },
    });
    expect(ok).toBe(false);
    expect(onSpawn).not.toHaveBeenCalled();
  });

  it('skips a tab_spawn with missing required fields', () => {
    const onSpawn = vi.fn();
    const data = JSON.stringify({
      payload: { tagKind: 'tab_spawn' /* missing tabId, tabType, title */ },
    });
    const ok = handleTabSseFrame({
      eventName: 'tab_spawn',
      rawData: data,
      handlers: { onSpawn },
    });
    expect(ok).toBe(false);
    expect(onSpawn).not.toHaveBeenCalled();
  });
});

describe('spawnPayloadToTab', () => {
  const base: TabSpawnPayload = {
    tagKind: 'tab_spawn',
    tabId: 'finance|focus:gold',
    tabType: 'finance',
    title: 'EN title',
    titleEn: 'EN title',
    titleSw: 'SW title',
    config: { window: 'quarter' },
    droppedKeys: [],
    source: 'brain',
  };

  it('picks the SW title when language is sw', () => {
    const tab = spawnPayloadToTab(base, 'sw');
    expect(tab?.title).toBe('SW title');
  });

  it('picks the EN title when language is en', () => {
    const tab = spawnPayloadToTab(base, 'en');
    expect(tab?.title).toBe('EN title');
  });

  it('falls back to `title` when neither locale variant is present', () => {
    const tab = spawnPayloadToTab(
      { ...base, titleEn: null, titleSw: null },
      'sw',
    );
    expect(tab?.title).toBe('EN title');
  });

  it('returns null for unknown tab kinds (defends FE store)', () => {
    const tab = spawnPayloadToTab({ ...base, tabType: 'rocket' }, 'en');
    expect(tab).toBeNull();
  });
});

describe('applyUpdatePatch', () => {
  const existing: OwnerTab = {
    id: 'finance|focus:gold',
    kind: 'finance',
    title: 'Old title',
    context: { window: 'quarter', mineralKind: 'gold' },
  };

  it('merges patch.config into existing context', () => {
    const patch: TabUpdatePayload = {
      tagKind: 'tab_update',
      tabId: 'finance|focus:gold',
      patch: { config: { window: 'week' } },
      source: 'brain',
    };
    const next = applyUpdatePatch(existing, patch, 'en');
    expect(next.context).toEqual({ window: 'week', mineralKind: 'gold' });
    expect(next.title).toBe('Old title');
  });

  it('honours title override (SW) when language is sw', () => {
    const patch: TabUpdatePayload = {
      tagKind: 'tab_update',
      tabId: 'finance|focus:gold',
      patch: { title: 'EN renamed' },
      titleSw: 'SW renamed',
      source: 'brain',
    };
    const next = applyUpdatePatch(existing, patch, 'sw');
    expect(next.title).toBe('SW renamed');
  });

  it('preserves existing tab when patch is empty', () => {
    const patch: TabUpdatePayload = {
      tagKind: 'tab_update',
      tabId: existing.id,
      patch: {},
      source: 'brain',
    };
    const next = applyUpdatePatch(existing, patch, 'en');
    expect(next).toEqual(existing);
  });
});
