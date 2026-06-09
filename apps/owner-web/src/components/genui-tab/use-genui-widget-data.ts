'use client';

/**
 * useGenuiWidgetData — resolve ONE generated widget's live data from its
 * schema-declared `binding`.
 *
 * A generated `PortalTabWidget` MAY carry a `binding` (K1a-extended shape):
 *
 *   binding.kind === 'query'  → a named, server-vetted read (e.g. the tab's
 *                               own record list, a roll-up, a KPI). `ref` is
 *                               the query id; `params` are bounded filters.
 *   binding.kind === 'tool'   → a read-only brain/tool call the gateway
 *                               allow-lists. Same `{ ref, params }` shape.
 *
 * The hook is GENERATIVE: it forwards the binding verbatim to a SINGLE typed
 * gateway endpoint and renders whatever the server returns, shaped by the
 * widget kind. There is NO per-widget code path — a brand-new generated tab
 * with a never-seen binding ref works the moment the server vets it. A widget
 * with NO binding stays a labelled placeholder (handled by the renderer).
 *
 * Endpoint (tab-scoped so the gateway RLS-scopes the read by tab + tenant):
 *   POST /api/v1/portal-genui/tabs/:tabId/widget-data
 *        body { binding: { kind, ref, params? } }
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
 * The schema-declared binding on a widget. Parsed permissively from the RAW
 * tab JSON (the strict `PortalTab` schema strips unknown keys, so the host
 * reads bindings off the un-stripped response — see `use-genui-tab-extras`).
 */
export const GenuiWidgetBindingSchema = z.object({
  kind: z.enum(GENUI_WIDGET_BINDING_KINDS),
  ref: z.string().min(1).max(200),
  params: z.record(z.string(), z.unknown()).optional(),
});

export type GenuiWidgetBinding = z.infer<typeof GenuiWidgetBindingSchema>;

/**
 * The resolved widget data. Loose by construction — the render site reads the
 * fields that match the widget kind (`rows` for table, `value` for kpi_card,
 * `items` for timeline). Unknown extra keys are tolerated.
 */
export type GenuiWidgetData = Readonly<Record<string, unknown>>;

const WidgetDataResponseSchema = z.record(z.string(), z.unknown());

/** Stable query key per (tab, widget-binding). */
function widgetDataKey(
  tabId: string,
  widgetKey: string,
  binding: GenuiWidgetBinding,
): readonly unknown[] {
  return [
    'genui-widget-data',
    tabId,
    widgetKey,
    binding.kind,
    binding.ref,
    binding.params ?? {},
  ];
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
