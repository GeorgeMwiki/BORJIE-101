'use client';

/**
 * useGenuiWidgetData — resolve ONE generated widget's live data from its
 * schema-declared `binding`.
 *
 * A generated `PortalTabWidget` MAY carry a `binding` (the CANONICAL K1a schema
 * shape — the same shape persisted on the widget):
 *
 *   binding.kind === 'query'  → a named, server-vetted read against a vetted
 *                               estate domain (e.g. the tab's own records, a
 *                               roll-up, a KPI). `resource` is the queryable
 *                               resource id; `filters` are bounded predicates.
 *   binding.kind === 'tool'   → a read-only brain/tool call the gateway
 *                               allow-lists. `toolId` is the tool id; `args`
 *                               are bounded arguments.
 *
 * The hook is GENERATIVE: it forwards the binding verbatim to a SINGLE typed
 * gateway endpoint and renders whatever the server returns, shaped by the
 * widget kind. There is NO per-widget code path — a brand-new generated tab
 * with a never-seen binding works the moment the server vets it. A widget with
 * NO binding stays a labelled placeholder (handled by the renderer).
 *
 * Endpoint (tab-scoped so the gateway RLS-scopes the read by tab + tenant):
 *   POST /api/v1/portal-genui/tabs/:tabId/widget-data
 *        body { binding: { kind:'query', resource, filters? }
 *                       | { kind:'tool', toolId, args? } }
 *        → { rows? , value? , items? , columns?, label?, unit?, ... }
 *
 * The response is kept loose (`Record<string, unknown>`) and re-validated per
 * widget kind at the render site, so a server shape drift degrades to an
 * honest empty widget instead of crashing the host. LIVE-only, no mock —
 * matches `use-genui-tab.ts`.
 */

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { apiRequest } from '@/lib/api-client';

/** The binding kinds a generated widget can declare. */
export const GENUI_WIDGET_BINDING_KINDS = ['query', 'tool'] as const;
export type GenuiWidgetBindingKind = (typeof GENUI_WIDGET_BINDING_KINDS)[number];

/**
 * The schema-declared binding on a widget — the CANONICAL K1a shape (a
 * discriminated union over `kind`). Parsed permissively from the RAW tab JSON
 * (the strict `PortalTab` schema strips unknown keys, so the host reads
 * bindings off the un-stripped response — see `use-genui-tab-extras`).
 *
 *   - `{ kind:'query', resource, filters? }` — a live read of a vetted estate
 *     domain (or the tab's own records).
 *   - `{ kind:'tool', toolId, args? }` — a vetted, read-only tool call.
 */
export const GenuiWidgetBindingSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('query'),
    resource: z.string().min(1).max(200),
    filters: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal('tool'),
    toolId: z.string().min(1).max(200),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
]);

export type GenuiWidgetBinding = z.infer<typeof GenuiWidgetBindingSchema>;

/**
 * The resolved widget data. Typed to the shape the resolver actually returns
 * (rows/value/items/columns/label/unit) with .passthrough() so unknown extra
 * keys added by future resolver versions are tolerated. Shape drift now
 * surfaces at parse time as an empty widget rather than silently propagating
 * into the renderer (cm-5 / owner-genui-4).
 *
 * NOTE: do NOT tighten to .strict() — future resolver additions would break
 * existing clients. .passthrough() is the correct balance.
 */
export type GenuiWidgetData = Readonly<Record<string, unknown>>;

const WidgetDataResponseSchema = z
  .object({
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
    columns: z.array(z.string()).optional(),
    value: z.unknown().optional(),
    label: z.string().optional(),
    unit: z.string().optional(),
    items: z.array(z.unknown()).optional(),
  })
  .passthrough();

/** The binding's stable name + bounded payload, per kind. */
function bindingTarget(binding: GenuiWidgetBinding): {
  readonly name: string;
  readonly payload: Readonly<Record<string, unknown>>;
} {
  return binding.kind === 'query'
    ? { name: binding.resource, payload: binding.filters ?? {} }
    : { name: binding.toolId, payload: binding.args ?? {} };
}

/** Stable query key per (tab, widget-binding). */
function widgetDataKey(
  tabId: string,
  widgetKey: string,
  binding: GenuiWidgetBinding,
): readonly unknown[] {
  const { name, payload } = bindingTarget(binding);
  return ['genui-widget-data', tabId, widgetKey, binding.kind, name, payload];
}

/**
 * Resolve the binding for a widget. Pass `binding: null` for a widget without
 * a binding — the query stays disabled (the hook is called unconditionally to
 * satisfy rules-of-hooks; the renderer shows a labelled placeholder instead).
 */
export function useGenuiWidgetData(args: {
  readonly tabId: string | null | undefined;
  readonly widgetKey: string;
  readonly binding: GenuiWidgetBinding | null;
}) {
  const { tabId, widgetKey, binding } = args;
  const enabled = Boolean(tabId) && binding !== null;
  return useQuery({
    queryKey: enabled
      ? widgetDataKey(tabId!, widgetKey, binding!)
      : ['genui-widget-data', 'disabled', widgetKey],
    enabled,
    queryFn: async ({ signal }): Promise<GenuiWidgetData> => {
      const raw = await apiRequest<unknown>(
        `/api/v1/portal-genui/tabs/${encodeURIComponent(tabId!)}/widget-data`,
        { method: 'POST', body: { binding }, signal },
      );
      const parsed = WidgetDataResponseSchema.safeParse(raw);
      // Shape drift degrades to an empty widget, never a render crash.
      return parsed.success ? parsed.data : {};
    },
    staleTime: 15_000,
  });
}
