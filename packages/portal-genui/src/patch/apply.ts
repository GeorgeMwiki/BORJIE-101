/**
 * `applyTabPatch` — the pure, immutable reducer that applies an A2UI-style
 * incremental patch to a `PortalTab`, producing a NEW validated tab.
 *
 * Why a reducer and not JSON-Patch: the ops are ID-addressed (by stable
 * section/field/widget keys), not path-addressed, so concurrent edits and
 * LLM-emitted patches are robust to reordering. Every mutation builds a new
 * object — NEVER mutates the input (CLAUDE.md immutability rule) — and the
 * final document is re-validated against the canonical `PortalTabSchema`, so
 * a patch can only ever produce a tab the host could also have received from
 * whole-tab generation. The whole-tab path is therefore fully preserved;
 * this is purely ADDITIVE.
 *
 * Errors are returned as a typed result (never thrown for the common
 * not-found / duplicate cases) so the caller — the gateway route or the
 * GenUITabHost preview — can surface a precise reason without a try/catch.
 * Schema-level failures (a merged field that violates its kind invariant)
 * also come back as a typed `validation` failure rather than a raw zod throw.
 */

import {
  PortalTabSchema,
  type PortalTab,
  type PortalTabSection,
  type PortalTabField,
  type PortalTabWidget,
  type PortalTabAuditEntry,
} from '../types.js';
import {
  type PortalTabPatch,
  type PortalTabPatchOp,
  safeParsePortalTabPatch,
} from './ops.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ApplyTabPatchOk {
  readonly ok: true;
  readonly tab: PortalTab;
  /** Number of ops applied — always equals `patch.ops.length` on success. */
  readonly appliedOps: number;
}

export interface ApplyTabPatchError {
  readonly ok: false;
  readonly reason:
    | 'patch-invalid'
    | 'tab-id-mismatch'
    | 'tab-not-found'
    | 'section-not-found'
    | 'section-key-conflict'
    | 'field-not-found'
    | 'field-key-conflict'
    | 'widget-not-found'
    | 'widget-key-conflict'
    | 'reference-not-found'
    | 'validation';
  readonly message: string;
  /** 0-based index of the op that failed (or -1 for whole-patch failures). */
  readonly opIndex: number;
}

export type ApplyTabPatchResult = ApplyTabPatchOk | ApplyTabPatchError;

export interface ApplyTabPatchOptions {
  /** Actor recorded in the audit ring-buffer. Defaults to `agent`. */
  readonly actor?: PortalTabAuditEntry['actor'];
  /** Actor id recorded in the audit ring-buffer. Required for provenance. */
  readonly actorId: string;
  /** Deterministic clock for the `updatedAt` + audit `at` timestamp. */
  readonly nowIso?: string;
}

// ---------------------------------------------------------------------------
// Small immutable helpers
// ---------------------------------------------------------------------------

function fail(
  reason: ApplyTabPatchError['reason'],
  message: string,
  opIndex: number,
): ApplyTabPatchError {
  return { ok: false, reason, message, opIndex };
}

function findSectionIndex(tab: PortalTab, key: string): number {
  return tab.sections.findIndex((s) => s.key === key);
}

/**
 * Drop keys whose value is `undefined` so a partial patch never clobbers a
 * required field with `undefined` under `exactOptionalPropertyTypes`. Pure.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] !== undefined) {
      out[key] = obj[key];
    }
  }
  return out;
}

/** Insert `item` into `list` before `beforeKey`, or append when absent. */
function insertBefore<T extends { key: string }>(
  list: ReadonlyArray<T>,
  item: T,
  beforeKey: string | undefined,
): T[] | null {
  if (beforeKey === undefined) {
    return [...list, item];
  }
  const idx = list.findIndex((entry) => entry.key === beforeKey);
  if (idx === -1) return null;
  return [...list.slice(0, idx), item, ...list.slice(idx)];
}

function replaceSection(
  tab: PortalTab,
  index: number,
  next: PortalTabSection,
): PortalTab {
  return {
    ...tab,
    sections: tab.sections.map((s, i) => (i === index ? next : s)),
  };
}

// ---------------------------------------------------------------------------
// Per-op application — each returns a new tab or a typed error.
// ---------------------------------------------------------------------------

function applyOne(
  tab: PortalTab,
  op: PortalTabPatchOp,
  opIndex: number,
): PortalTab | ApplyTabPatchError {
  switch (op.op) {
    case 'add-section': {
      if (findSectionIndex(tab, op.section.key) !== -1) {
        return fail(
          'section-key-conflict',
          `section key '${op.section.key}' already exists`,
          opIndex,
        );
      }
      const next = insertBefore(tab.sections, op.section, op.beforeSectionKey);
      if (next === null) {
        return fail(
          'reference-not-found',
          `beforeSectionKey '${op.beforeSectionKey}' not found`,
          opIndex,
        );
      }
      return { ...tab, sections: next };
    }

    case 'remove-section': {
      const idx = findSectionIndex(tab, op.sectionKey);
      if (idx === -1) {
        return fail('section-not-found', `section '${op.sectionKey}' not found`, opIndex);
      }
      return { ...tab, sections: tab.sections.filter((_, i) => i !== idx) };
    }

    case 'move-section': {
      const idx = findSectionIndex(tab, op.sectionKey);
      if (idx === -1) {
        return fail('section-not-found', `section '${op.sectionKey}' not found`, opIndex);
      }
      const without = tab.sections.filter((_, i) => i !== idx);
      const target = Math.min(op.toIndex, without.length);
      const moved = tab.sections[idx]!;
      return {
        ...tab,
        sections: [...without.slice(0, target), moved, ...without.slice(target)],
      };
    }

    case 'update-section': {
      const idx = findSectionIndex(tab, op.sectionKey);
      if (idx === -1) {
        return fail('section-not-found', `section '${op.sectionKey}' not found`, opIndex);
      }
      const current = tab.sections[idx]!;
      const next: PortalTabSection = {
        ...current,
        ...(op.title !== undefined ? { title: op.title } : {}),
        ...(op.description !== undefined ? { description: op.description } : {}),
        ...(op.defaultCollapsed !== undefined
          ? { defaultCollapsed: op.defaultCollapsed }
          : {}),
      };
      return replaceSection(tab, idx, next);
    }

    case 'add-field': {
      const idx = findSectionIndex(tab, op.sectionKey);
      if (idx === -1) {
        return fail('section-not-found', `section '${op.sectionKey}' not found`, opIndex);
      }
      const section = tab.sections[idx]!;
      if (section.fields.some((f) => f.key === op.field.key)) {
        return fail(
          'field-key-conflict',
          `field key '${op.field.key}' already exists in section '${op.sectionKey}'`,
          opIndex,
        );
      }
      const fields = insertBefore(section.fields, op.field, op.beforeFieldKey);
      if (fields === null) {
        return fail(
          'reference-not-found',
          `beforeFieldKey '${op.beforeFieldKey}' not found in section '${op.sectionKey}'`,
          opIndex,
        );
      }
      return replaceSection(tab, idx, { ...section, fields });
    }

    case 'remove-field': {
      const idx = findSectionIndex(tab, op.sectionKey);
      if (idx === -1) {
        return fail('section-not-found', `section '${op.sectionKey}' not found`, opIndex);
      }
      const section = tab.sections[idx]!;
      if (!section.fields.some((f) => f.key === op.fieldKey)) {
        return fail(
          'field-not-found',
          `field '${op.fieldKey}' not found in section '${op.sectionKey}'`,
          opIndex,
        );
      }
      return replaceSection(tab, idx, {
        ...section,
        fields: section.fields.filter((f) => f.key !== op.fieldKey),
      });
    }

    case 'update-field': {
      const idx = findSectionIndex(tab, op.sectionKey);
      if (idx === -1) {
        return fail('section-not-found', `section '${op.sectionKey}' not found`, opIndex);
      }
      const section = tab.sections[idx]!;
      const fieldIdx = section.fields.findIndex((f) => f.key === op.fieldKey);
      if (fieldIdx === -1) {
        return fail(
          'field-not-found',
          `field '${op.fieldKey}' not found in section '${op.sectionKey}'`,
          opIndex,
        );
      }
      const current = section.fields[fieldIdx]!;
      // Merge the partial patch; key + kind are immutable through this op.
      // `stripUndefined` keeps required props (label) from being clobbered;
      // the final tab is re-validated against the schema by the reducer.
      const merged = {
        ...current,
        ...stripUndefined(op.patch),
        key: current.key,
        kind: current.kind,
      } as PortalTabField;
      const fields = section.fields.map((f, i) => (i === fieldIdx ? merged : f));
      return replaceSection(tab, idx, { ...section, fields });
    }

    case 'add-widget': {
      const idx = findSectionIndex(tab, op.sectionKey);
      if (idx === -1) {
        return fail('section-not-found', `section '${op.sectionKey}' not found`, opIndex);
      }
      const section = tab.sections[idx]!;
      if (section.widgets.some((w) => w.key === op.widget.key)) {
        return fail(
          'widget-key-conflict',
          `widget key '${op.widget.key}' already exists in section '${op.sectionKey}'`,
          opIndex,
        );
      }
      const widgets = insertBefore(section.widgets, op.widget, op.beforeWidgetKey);
      if (widgets === null) {
        return fail(
          'reference-not-found',
          `beforeWidgetKey '${op.beforeWidgetKey}' not found in section '${op.sectionKey}'`,
          opIndex,
        );
      }
      return replaceSection(tab, idx, { ...section, widgets });
    }

    case 'remove-widget': {
      const idx = findSectionIndex(tab, op.sectionKey);
      if (idx === -1) {
        return fail('section-not-found', `section '${op.sectionKey}' not found`, opIndex);
      }
      const section = tab.sections[idx]!;
      if (!section.widgets.some((w) => w.key === op.widgetKey)) {
        return fail(
          'widget-not-found',
          `widget '${op.widgetKey}' not found in section '${op.sectionKey}'`,
          opIndex,
        );
      }
      return replaceSection(tab, idx, {
        ...section,
        widgets: section.widgets.filter((w) => w.key !== op.widgetKey),
      });
    }

    case 'update-widget': {
      const idx = findSectionIndex(tab, op.sectionKey);
      if (idx === -1) {
        return fail('section-not-found', `section '${op.sectionKey}' not found`, opIndex);
      }
      const section = tab.sections[idx]!;
      const widgetIdx = section.widgets.findIndex((w) => w.key === op.widgetKey);
      if (widgetIdx === -1) {
        return fail(
          'widget-not-found',
          `widget '${op.widgetKey}' not found in section '${op.sectionKey}'`,
          opIndex,
        );
      }
      const current = section.widgets[widgetIdx]!;
      const merged: PortalTabWidget = {
        ...current,
        ...stripUndefined(op.patch),
        key: current.key,
        kind: current.kind,
      } as PortalTabWidget;
      const widgets = section.widgets.map((w, i) => (i === widgetIdx ? merged : w));
      return replaceSection(tab, idx, { ...section, widgets });
    }

    case 'update-tab-meta': {
      return {
        ...tab,
        ...(op.title !== undefined ? { title: op.title } : {}),
        ...(op.description !== undefined ? { description: op.description } : {}),
        ...(op.icon !== undefined ? { icon: op.icon } : {}),
      };
    }

    default: {
      // Unreachable for valid input — the patch was already schema-validated,
      // so `op.op` is one of the literals above. Defensive belt only.
      return fail(
        'patch-invalid',
        `unknown op: ${(op as { op?: string }).op ?? '?'}`,
        opIndex,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Audit ring-buffer append (last-50, immutable).
// ---------------------------------------------------------------------------

function appendAudit(
  tab: PortalTab,
  options: ApplyTabPatchOptions,
  nowIso: string,
  opCount: number,
  sourceConversationId: string | undefined,
): PortalTab {
  const actor = options.actor ?? 'agent';
  const entry: PortalTabAuditEntry = {
    actor,
    actorId: options.actorId,
    action: 'edited',
    at: nowIso,
    note: `incremental patch (${opCount} op${opCount === 1 ? '' : 's'})`,
  };
  const history = [...tab.audit.history, entry].slice(-50);
  return {
    ...tab,
    updatedAt: nowIso,
    audit: {
      ...tab.audit,
      updatedBy: options.actorId,
      history,
      ...(sourceConversationId !== undefined ? { sourceConversationId } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Public reducer
// ---------------------------------------------------------------------------

/**
 * Apply a flat A2UI patch to a tab. Pure — returns a NEW validated tab or a
 * typed error. The input tab is never mutated. Ops apply in order; the first
 * failing op aborts the whole patch (atomic — partial patches never land).
 */
export function applyTabPatch(
  tab: PortalTab,
  patch: PortalTabPatch,
  options: ApplyTabPatchOptions,
): ApplyTabPatchResult {
  // Re-validate the patch defensively even if the caller pre-parsed it.
  const parsed = safeParsePortalTabPatch(patch);
  if (!parsed) {
    return fail('patch-invalid', 'patch failed schema validation', -1);
  }
  if (parsed.tabId !== tab.id) {
    return fail(
      'tab-id-mismatch',
      `patch.tabId '${parsed.tabId}' does not match tab.id '${tab.id}'`,
      -1,
    );
  }

  const nowIso = options.nowIso ?? new Date().toISOString();

  let working: PortalTab = tab;
  for (let i = 0; i < parsed.ops.length; i += 1) {
    const result = applyOne(working, parsed.ops[i]!, i);
    if ('ok' in result) {
      // result is an ApplyTabPatchError
      return result;
    }
    working = result;
  }

  // Append audit provenance, then re-validate the WHOLE document so a patch
  // can never produce a tab the host could not also receive from full
  // generation (e.g. duplicate field keys across sections, empty sections).
  const audited = appendAudit(
    working,
    options,
    nowIso,
    parsed.ops.length,
    parsed.sourceConversationId,
  );

  const validated = PortalTabSchema.safeParse(audited);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    return fail(
      'validation',
      issue
        ? `${issue.path.join('.')}: ${issue.message}`
        : 'patched tab failed schema validation',
      -1,
    );
  }

  return { ok: true, tab: validated.data, appliedOps: parsed.ops.length };
}
