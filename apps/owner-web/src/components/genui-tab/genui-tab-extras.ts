'use client';

/**
 * genui-tab-extras — the K1a-extended overlay reader.
 *
 * The strict `PortalTab` schema (`@borjie/portal-genui`) is intentionally
 * `.strict()`, so `safeParsePortalTab` DROPS the keys K1a adds to make a tab
 * ACT: a per-widget `binding`, a per-tab `record` flag, and schema-declared
 * `action` buttons on widgets. This module reads those off the UN-stripped tab
 * JSON the gateway returned (surfaced by `use-genui-tab` as `raw`) and
 * re-validates them defensively. It is pure data, generative by construction —
 * NO per-tab branching, just "what did the schema declare for THIS key".
 *
 * Everything degrades safe: a malformed overlay parses to "no extras" so the
 * tab falls back to the inert preview rather than crashing the host.
 */

import { z } from 'zod';

import {
  GenuiWidgetBindingSchema,
  type GenuiWidgetBinding,
} from './use-genui-widget-data';

/**
 * A schema-declared action button on a widget. The owner taps it; the host
 * dispatches `{ verb, params }` to the SAME fulfillment endpoint home-chat
 * uses (`POST /api/v1/owner/chat/confirm-action`).
 */
export const GenuiActionSchema = z.object({
  /** Stable id for the button (key + react list key). */
  id: z.string().min(1).max(120),
  /** Human label — sanitised + (where missing) localised at the render site. */
  label: z.string().max(200).optional(),
  /** The fulfillment verb forwarded to the action-bridge. */
  verb: z.string().min(1).max(200),
  /** Bounded params forwarded verbatim to the matching tool. */
  params: z.record(z.string(), z.unknown()).optional(),
});

export type GenuiAction = z.infer<typeof GenuiActionSchema>;

/** The record flag — when true, the tab persists form submissions. */
const TabRecordFlagSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .nullable()
  .optional();

/**
 * Per-widget overlay: an optional data `binding` and zero-or-more `actions`.
 * Keyed by the widget's `key` so the renderer looks up its own extras without
 * the host threading anything per-widget.
 */
export interface GenuiWidgetExtras {
  readonly binding: GenuiWidgetBinding | null;
  readonly actions: ReadonlyArray<GenuiAction>;
}

export interface GenuiTabExtras {
  /** True when the tab declares `record.enabled` (form persists submissions). */
  readonly recordEnabled: boolean;
  /** Widget extras (binding + actions) by widget key. */
  readonly widgets: ReadonlyMap<string, GenuiWidgetExtras>;
}

const EMPTY_EXTRAS: GenuiTabExtras = {
  recordEnabled: false,
  widgets: new Map(),
};

/**
 * Parse a widget binding from the raw overlay. Accepts both:
 *  - The canonical K1a discriminated-union shape: { kind, resource/toolId, … }
 *  - The legacy pre-K1a shape: { ref, params } — migrated on-the-fly to
 *    { kind:'query', resource:ref, filters:params } so tabs persisted before
 *    the schema migration still resolve live data instead of silently rendering
 *    an empty placeholder (owner-genui-7).
 *
 * Once all persisted tabs have been batch-migrated to the canonical shape this
 * shim can be deleted.
 */
function parseBinding(value: unknown): GenuiWidgetBinding | null {
  if (value == null) return null;

  // Fast path: canonical discriminated-union shape.
  const canonical = GenuiWidgetBindingSchema.safeParse(value);
  if (canonical.success) return canonical.data;

  // Backward-compat shim: legacy { ref?, params? } → { kind:'query', resource, filters }.
  const legacy =
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;

  if (
    legacy &&
    typeof legacy.ref === 'string' &&
    legacy.ref.length > 0 &&
    !('kind' in legacy)
  ) {
    // Silently coerce the legacy shape. Observability hooks (Sentry) will see
    // this widget resolve data where before it rendered a placeholder — no
    // alert needed. The migration is purely additive and forward-compatible.
    const coerced = {
      kind: 'query' as const,
      resource: legacy.ref,
      ...(legacy.params && typeof legacy.params === 'object' && !Array.isArray(legacy.params)
        ? { filters: legacy.params as Record<string, unknown> }
        : {}),
    };
    const migrated = GenuiWidgetBindingSchema.safeParse(coerced);
    if (migrated.success) return migrated.data;
  }

  return null;
}

function parseActions(value: unknown): ReadonlyArray<GenuiAction> {
  if (!Array.isArray(value)) return [];
  const out: GenuiAction[] = [];
  for (const item of value) {
    const parsed = GenuiActionSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Read the K1a overlay off the raw tab JSON. Returns empty extras (inert
 * preview) when `raw` is null/malformed.
 */
export function readGenuiTabExtras(
  raw: Readonly<Record<string, unknown>> | null | undefined,
): GenuiTabExtras {
  const root = readObject(raw);
  if (!root) return EMPTY_EXTRAS;

  const recordParsed = TabRecordFlagSchema.safeParse(root.record);
  const recordEnabled =
    recordParsed.success && recordParsed.data?.enabled === true;

  const widgets = new Map<string, GenuiWidgetExtras>();
  const sections = Array.isArray(root.sections) ? root.sections : [];
  for (const sectionRaw of sections) {
    const section = readObject(sectionRaw);
    if (!section) continue;
    const widgetList = Array.isArray(section.widgets) ? section.widgets : [];
    for (const widgetRaw of widgetList) {
      const widget = readObject(widgetRaw);
      if (!widget) continue;
      const key = typeof widget.key === 'string' ? widget.key : null;
      if (!key) continue;
      const binding = parseBinding(widget.binding);
      const actions = parseActions(widget.actions);
      if (binding || actions.length > 0) {
        widgets.set(key, { binding, actions });
      }
    }
  }

  return { recordEnabled, widgets };
}

/** Look up the extras for one widget key (binding + actions). */
export function widgetExtrasFor(
  extras: GenuiTabExtras,
  widgetKey: string,
): GenuiWidgetExtras {
  return extras.widgets.get(widgetKey) ?? { binding: null, actions: [] };
}
