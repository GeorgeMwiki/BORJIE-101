/**
 * A2UI incremental patch — op-schema + reducer tests.
 *
 * Proves the "MD edits a live surface without a full re-render" path:
 *   - every op kind applies and produces a NEW, schema-valid tab
 *   - the input tab is NEVER mutated (immutability)
 *   - patches are atomic (first failing op aborts the whole patch)
 *   - the reducer re-validates against PortalTabSchema (a patch can't
 *     produce a tab whole-tab generation couldn't)
 *   - ID-addressing: unknown section/field/widget keys return typed errors
 */

import { describe, it, expect } from 'vitest';

import {
  PortalTabPatchSchema,
  safeParsePortalTabPatch,
  PORTAL_TAB_PATCH_OP_KINDS,
  applyTabPatch,
  type PortalTabPatch,
} from '../patch/index.js';
import { buildFallbackTab } from '../generator/fallbacks.js';
import { PortalTabSchema, type PortalTab } from '../types.js';

const NOW = '2026-06-08T10:00:00.000Z';

function freshTab(): PortalTab {
  return buildFallbackTab({
    intent: {
      proposedTabKey: 'hr.payroll',
      proposedTabTitle: 'Payroll',
      domain: 'hr',
      confidence: 0.8,
      evidence: [],
      sourceMessage: 's',
      usedLlm: false,
    },
    tenantId: 't1',
    userId: 'u1',
    actorId: 'system',
    nowIso: '2026-05-24T12:00:00.000Z',
    id: 'tab_a',
    sourceConversationId: undefined,
  });
}

function mkPatch(ops: PortalTabPatch['ops']): PortalTabPatch {
  return { version: 1, tabId: 'tab_a', ops };
}

const APPLY_OPTS = { actorId: 'agent-1', actor: 'agent' as const, nowIso: NOW };

describe('PortalTabPatchSchema (op vocabulary)', () => {
  it('exposes every op kind in the union', () => {
    expect(PORTAL_TAB_PATCH_OP_KINDS).toHaveLength(11);
  });

  it('rejects an empty op list', () => {
    expect(safeParsePortalTabPatch({ version: 1, tabId: 't', ops: [] })).toBeNull();
  });

  it('rejects an unknown op kind', () => {
    const bad = { version: 1, tabId: 't', ops: [{ op: 'nuke-everything' }] };
    expect(safeParsePortalTabPatch(bad)).toBeNull();
  });

  it('rejects update-tab-meta with no fields set', () => {
    const result = PortalTabPatchSchema.safeParse(
      mkPatch([{ op: 'update-tab-meta' } as never]),
    );
    expect(result.success).toBe(false);
  });
});

describe('applyTabPatch — field ops (add-column == add-field)', () => {
  it('adds a field (a labelled column) to a section', () => {
    const tab = freshTab();
    const sectionKey = tab.sections[0]!.key;
    const before = tab.sections[0]!.fields.length;
    const patch = mkPatch([
      {
        op: 'add-field',
        sectionKey,
        field: { key: 'bonus', label: 'Bonus', kind: 'currency', span: 4 },
      },
    ]);

    const result = applyTabPatch(tab, patch, APPLY_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tab.sections[0]!.fields).toHaveLength(before + 1);
    expect(result.tab.sections[0]!.fields.at(-1)!.key).toBe('bonus');
    // Input untouched.
    expect(tab.sections[0]!.fields).toHaveLength(before);
  });

  it('inserts a field BEFORE a referenced field key', () => {
    const tab = freshTab();
    const section = tab.sections[0]!;
    const anchorKey = section.fields[0]!.key;
    const patch = mkPatch([
      {
        op: 'add-field',
        sectionKey: section.key,
        beforeFieldKey: anchorKey,
        field: { key: 'first_col', label: 'First', kind: 'text' },
      },
    ]);
    const result = applyTabPatch(tab, patch, APPLY_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tab.sections[0]!.fields[0]!.key).toBe('first_col');
  });

  it('rejects a duplicate field key in the same section', () => {
    const tab = freshTab();
    const section = tab.sections[0]!;
    const dupKey = section.fields[0]!.key;
    const patch = mkPatch([
      {
        op: 'add-field',
        sectionKey: section.key,
        field: { key: dupKey, label: 'Dup', kind: 'text' },
      },
    ]);
    const result = applyTabPatch(tab, patch, APPLY_OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('field-key-conflict');
  });

  it('updates an existing field label without changing key/kind', () => {
    const tab = freshTab();
    const section = tab.sections[0]!;
    const fieldKey = section.fields[0]!.key;
    const originalKind = section.fields[0]!.kind;
    const patch = mkPatch([
      {
        op: 'update-field',
        sectionKey: section.key,
        fieldKey,
        patch: { label: 'Renamed', required: true },
      },
    ]);
    const result = applyTabPatch(tab, patch, APPLY_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updated = result.tab.sections[0]!.fields.find((f) => f.key === fieldKey)!;
    expect(updated.label).toBe('Renamed');
    expect(updated.required).toBe(true);
    expect(updated.kind).toBe(originalKind);
  });

  it('removes a field by key', () => {
    const tab = freshTab();
    const section = tab.sections[0]!;
    // Ensure the section keeps at least one field/widget after removal.
    const removable =
      section.fields.length > 1 ? section.fields[1]!.key : section.fields[0]!.key;
    const hasWidgets = section.widgets.length > 0;
    if (section.fields.length === 1 && !hasWidgets) return; // not applicable
    const patch = mkPatch([
      { op: 'remove-field', sectionKey: section.key, fieldKey: removable },
    ]);
    const result = applyTabPatch(tab, patch, APPLY_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.tab.sections[0]!.fields.some((f) => f.key === removable),
    ).toBe(false);
  });

  it('returns field-not-found for an unknown field key', () => {
    const tab = freshTab();
    const patch = mkPatch([
      {
        op: 'remove-field',
        sectionKey: tab.sections[0]!.key,
        fieldKey: 'does_not_exist',
      },
    ]);
    const result = applyTabPatch(tab, patch, APPLY_OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('field-not-found');
  });
});

describe('applyTabPatch — section ops (move-section)', () => {
  it('adds then moves a section', () => {
    const tab = freshTab();
    const patch = mkPatch([
      {
        op: 'add-section',
        section: {
          key: 'extra',
          title: 'Extra',
          fields: [{ key: 'note', label: 'Note', kind: 'text' }],
          widgets: [],
        },
      },
      { op: 'move-section', sectionKey: 'extra', toIndex: 0 },
    ]);
    const result = applyTabPatch(tab, patch, APPLY_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tab.sections[0]!.key).toBe('extra');
    expect(result.appliedOps).toBe(2);
  });

  it('clamps move-section toIndex past the end', () => {
    const tab = freshTab();
    const firstKey = tab.sections[0]!.key;
    const patch = mkPatch([
      { op: 'move-section', sectionKey: firstKey, toIndex: 19 },
    ]);
    const result = applyTabPatch(tab, patch, APPLY_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tab.sections.at(-1)!.key).toBe(firstKey);
  });

  it('rejects a duplicate section key', () => {
    const tab = freshTab();
    const dupKey = tab.sections[0]!.key;
    const patch = mkPatch([
      {
        op: 'add-section',
        section: {
          key: dupKey,
          title: 'Dup',
          fields: [{ key: 'x', label: 'X', kind: 'text' }],
          widgets: [],
        },
      },
    ]);
    const result = applyTabPatch(tab, patch, APPLY_OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('section-key-conflict');
  });

  it('updates section title only', () => {
    const tab = freshTab();
    const key = tab.sections[0]!.key;
    const patch = mkPatch([
      { op: 'update-section', sectionKey: key, title: 'New Title' },
    ]);
    const result = applyTabPatch(tab, patch, APPLY_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tab.sections[0]!.title).toBe('New Title');
  });
});

describe('applyTabPatch — widget ops', () => {
  it('adds a widget to a section', () => {
    const tab = freshTab();
    const sectionKey = tab.sections[0]!.key;
    const patch = mkPatch([
      {
        op: 'add-widget',
        sectionKey,
        widget: {
          key: 'headcount_kpi',
          kind: 'kpi_card',
          title: 'Headcount',
          config: { value: 0 },
        },
      },
    ]);
    const result = applyTabPatch(tab, patch, APPLY_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.tab.sections[0]!.widgets.some((w) => w.key === 'headcount_kpi'),
    ).toBe(true);
  });

  it('updates a widget title via patch', () => {
    const tab = freshTab();
    const sectionKey = tab.sections[0]!.key;
    const added = applyTabPatch(
      tab,
      mkPatch([
        {
          op: 'add-widget',
          sectionKey,
          widget: { key: 'w1', kind: 'table', title: 'Old', config: null },
        },
      ]),
      APPLY_OPTS,
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const updated = applyTabPatch(
      added.tab,
      mkPatch([
        {
          op: 'update-widget',
          sectionKey,
          widgetKey: 'w1',
          patch: { title: 'New' },
        },
      ]),
      APPLY_OPTS,
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const w = updated.tab.sections[0]!.widgets.find((x) => x.key === 'w1')!;
    expect(w.title).toBe('New');
    expect(w.kind).toBe('table');
  });
});

describe('applyTabPatch — tab meta + atomicity + safety', () => {
  it('updates tab title + description', () => {
    const tab = freshTab();
    const patch = mkPatch([
      { op: 'update-tab-meta', title: 'HR Hub', description: 'All HR' },
    ]);
    const result = applyTabPatch(tab, patch, APPLY_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tab.title).toBe('HR Hub');
    expect(result.tab.description).toBe('All HR');
  });

  it('appends an audit entry + bumps updatedAt', () => {
    const tab = freshTab();
    const beforeHistory = tab.audit.history.length;
    const result = applyTabPatch(
      tab,
      mkPatch([{ op: 'update-tab-meta', title: 'X' }]),
      APPLY_OPTS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tab.audit.history.length).toBe(beforeHistory + 1);
    expect(result.tab.audit.history.at(-1)!.action).toBe('edited');
    expect(result.tab.audit.history.at(-1)!.actorId).toBe('agent-1');
    expect(result.tab.updatedAt).toBe(NOW);
  });

  it('is atomic — a later failing op aborts the whole patch', () => {
    const tab = freshTab();
    const sectionKey = tab.sections[0]!.key;
    const patch = mkPatch([
      {
        op: 'add-field',
        sectionKey,
        field: { key: 'ok_field', label: 'OK', kind: 'text' },
      },
      // This op fails — section does not exist.
      { op: 'remove-section', sectionKey: 'ghost' },
    ]);
    const result = applyTabPatch(tab, patch, APPLY_OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('section-not-found');
    expect(result.opIndex).toBe(1);
    // The good first op did NOT land — input still has no 'ok_field'.
    expect(
      tab.sections[0]!.fields.some((f) => f.key === 'ok_field'),
    ).toBe(false);
  });

  it('rejects a patch whose tabId does not match the tab', () => {
    const tab = freshTab();
    const patch: PortalTabPatch = {
      version: 1,
      tabId: 'wrong_tab',
      ops: [{ op: 'update-tab-meta', title: 'X' }],
    };
    const result = applyTabPatch(tab, patch, APPLY_OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('tab-id-mismatch');
  });

  it('always returns a tab that re-validates against PortalTabSchema', () => {
    const tab = freshTab();
    const sectionKey = tab.sections[0]!.key;
    const result = applyTabPatch(
      tab,
      mkPatch([
        {
          op: 'add-field',
          sectionKey,
          field: { key: 'extra_col', label: 'Extra', kind: 'number' },
        },
      ]),
      APPLY_OPTS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => PortalTabSchema.parse(result.tab)).not.toThrow();
  });
});
