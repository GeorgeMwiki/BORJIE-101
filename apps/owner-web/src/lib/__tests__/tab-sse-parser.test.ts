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
  type GenuiTabProposalPayload,
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
    // Closure Wave 8 — the artifact-render seam events.
    expect(isTabSseEvent('artifact_proposal')).toBe(true);
    expect(isTabSseEvent('cockpit.tab.proposed')).toBe(true);
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

  // ── portal-genui proposal family (shares the tab_proposal event) ──
  const genuiFrame = (overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({
      payload: {
        tagKind: 'tab_proposal',
        source: 'portal-genui',
        proposalId: 'genui:t1:u1:tab_abc',
        tabId: 'tab_abc',
        tabKey: 'staff.payroll',
        title: 'Staff Payroll',
        description: 'Track monthly payroll',
        domain: 'hr',
        icon: 'users',
        reason: 'I drafted a new "Staff Payroll" tab. Review it before saving.',
        confidence: 0.82,
        generationSource: 'llm',
        summary: {
          sectionCount: 2,
          fieldCount: 6,
          widgetCount: 1,
          sections: [
            {
              key: 's1',
              title: 'Employees',
              fieldCount: 6,
              widgetCount: 1,
              fieldLabels: ['Name', 'Salary'],
            },
          ],
        },
        tab: { id: 'tab_abc', tabKey: 'staff.payroll', sections: [] },
        ...overrides,
      },
    });

  it('routes a portal-genui proposal to onGenuiProposal, not onProposal', () => {
    const onGenuiProposal = vi.fn();
    const onProposal = vi.fn();
    const ok = handleTabSseFrame({
      eventName: 'tab_proposal',
      rawData: genuiFrame(),
      handlers: { onGenuiProposal, onProposal },
    });
    expect(ok).toBe(true);
    expect(onProposal).not.toHaveBeenCalled();
    expect(onGenuiProposal).toHaveBeenCalledTimes(1);
    const arg = onGenuiProposal.mock.calls[0]?.[0] as GenuiTabProposalPayload;
    expect(arg.source).toBe('portal-genui');
    expect(arg.tabId).toBe('tab_abc');
    expect(arg.summary.fieldCount).toBe(6);
  });

  it('rejects a malformed portal-genui proposal (missing summary)', () => {
    const onGenuiProposal = vi.fn();
    const ok = handleTabSseFrame({
      eventName: 'tab_proposal',
      rawData: genuiFrame({ summary: undefined }),
      handlers: { onGenuiProposal },
    });
    expect(ok).toBe(false);
    expect(onGenuiProposal).not.toHaveBeenCalled();
  });

  it('still routes a static proposal to onProposal when both handlers exist', () => {
    const onGenuiProposal = vi.fn();
    const onProposal = vi.fn();
    const data = JSON.stringify({
      payload: {
        tagKind: 'tab_proposal',
        proposalId: 'brain:t1:u1:1234:finance',
        tabType: 'finance',
        title: 'Pin Royalty Tracker',
        reasonEn: 'You drilled in 3 times this week',
        evidenceIds: ['obs-1'],
        config: {},
      },
    });
    const ok = handleTabSseFrame({
      eventName: 'tab_proposal',
      rawData: data,
      handlers: { onGenuiProposal, onProposal },
    });
    expect(ok).toBe(true);
    expect(onGenuiProposal).not.toHaveBeenCalled();
    expect(onProposal).toHaveBeenCalledTimes(1);
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

  // ── modality artifact proposal family (closure Wave 8) ──────────────
  it('routes a dedicated artifact_proposal frame to onArtifactProposal', () => {
    const onArtifactProposal = vi.fn();
    const data = JSON.stringify({
      payload: {
        proposalId: 'modality:t1:forecast:abc',
        artifactKind: 'forecast',
        title: 'Forecast: gold price',
        reasonEn: 'Calibrated advisory forecast ready to review.',
        evidenceIds: ['borjie:ev:1'],
        confidence: 0.82,
        posture: 'propose',
      },
      at: '2026-06-08T12:00:00Z',
    });
    const ok = handleTabSseFrame({
      eventName: 'artifact_proposal',
      rawData: data,
      handlers: { onArtifactProposal },
    });
    expect(ok).toBe(true);
    expect(onArtifactProposal).toHaveBeenCalledTimes(1);
    const arg = onArtifactProposal.mock.calls[0]?.[0];
    expect(arg.artifactKind).toBe('forecast');
    expect(arg.proposalId).toBe('modality:t1:forecast:abc');
    expect(arg.evidenceIds).toEqual(['borjie:ev:1']);
  });

  it('routes a modality-arbiter tab_proposal to onArtifactProposal (not genui/static)', () => {
    const onArtifactProposal = vi.fn();
    const onGenuiProposal = vi.fn();
    const onProposal = vi.fn();
    // The cockpit-bus / sink shape: source=modality-arbiter, tabType=genui_<kind>,
    // evidence_ids snake-case, reason (not reasonEn).
    const data = JSON.stringify({
      payload: {
        source: 'modality-arbiter',
        proposalId: 'inbox-row-77',
        tabType: 'genui_document',
        title: 'Document: royalty return',
        reason: 'Generated royalty return ready to review.',
        evidence_ids: ['borjie:ev:9', 'borjie:ev:10'],
        confidence: 0.91,
      },
    });
    const ok = handleTabSseFrame({
      eventName: 'tab_proposal',
      rawData: data,
      handlers: { onArtifactProposal, onGenuiProposal, onProposal },
    });
    expect(ok).toBe(true);
    expect(onArtifactProposal).toHaveBeenCalledTimes(1);
    expect(onGenuiProposal).not.toHaveBeenCalled();
    expect(onProposal).not.toHaveBeenCalled();
    const arg = onArtifactProposal.mock.calls[0]?.[0];
    expect(arg.artifactKind).toBe('document');
    expect(arg.evidenceIds).toEqual(['borjie:ev:9', 'borjie:ev:10']);
  });

  it('routes a cockpit.tab.proposed envelope with a genui_ tabType to onArtifactProposal', () => {
    const onArtifactProposal = vi.fn();
    const data = JSON.stringify({
      payload: {
        proposalId: 'inbox-row-88',
        tabType: 'genui_media',
        title: 'Media: investor brand video',
        reasonEn: 'Generated video ready to review.',
        evidenceIds: ['borjie:ev:5'],
      },
    });
    const ok = handleTabSseFrame({
      eventName: 'cockpit.tab.proposed',
      rawData: data,
      handlers: { onArtifactProposal },
    });
    expect(ok).toBe(true);
    expect(onArtifactProposal).toHaveBeenCalledTimes(1);
    expect(onArtifactProposal.mock.calls[0]?.[0].artifactKind).toBe('media');
  });

  it('drops an artifact proposal with an empty evidence chain (no dispatch)', () => {
    const onArtifactProposal = vi.fn();
    const data = JSON.stringify({
      payload: {
        proposalId: 'p1',
        artifactKind: 'forecast',
        title: 'Forecast',
        evidenceIds: [], // evidence-required — must be ≥1
      },
    });
    const ok = handleTabSseFrame({
      eventName: 'artifact_proposal',
      rawData: data,
      handlers: { onArtifactProposal },
    });
    expect(ok).toBe(false);
    expect(onArtifactProposal).not.toHaveBeenCalled();
  });

  it('drops a cockpit.tab.proposed for a non-artifact tabType (no dispatch)', () => {
    const onArtifactProposal = vi.fn();
    const data = JSON.stringify({
      payload: {
        proposalId: 'p2',
        tabType: 'finance', // a static-registry tab, not an artifact
        title: 'Finance',
        evidenceIds: ['borjie:ev:1'],
      },
    });
    const ok = handleTabSseFrame({
      eventName: 'cockpit.tab.proposed',
      rawData: data,
      handlers: { onArtifactProposal },
    });
    expect(ok).toBe(false);
    expect(onArtifactProposal).not.toHaveBeenCalled();
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
