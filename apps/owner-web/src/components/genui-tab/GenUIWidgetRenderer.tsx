'use client';

/**
 * GenUIWidgetRenderer — renders ONE generated `PortalTabWidget` using the
 * EXISTING widget catalog from `@borjie/portal-genui` (widgets/registry).
 *
 * The registry stays React-free (rendererName strings + metadata), so this
 * is the owner-web binding: each of the 14 widget kinds renders as a titled
 * card carrying the kind's human label + description from the registry. The
 * card is a faithful placeholder — the live data hook that fills each widget
 * (a table's rows, a KPI's value) is wired per-surface later; the preview's
 * job is to show the MD the exact widget shape the generated tab declares.
 *
 * All title/subtitle text is sanitised to plain text via `toSafeText`
 * (CLAUDE.md: no raw HTML interpolation).
 */

import { type ReactElement } from 'react';
import {
  getWidgetKindMetadata,
  type PortalTabWidget,
} from '@borjie/portal-genui';

import { toSafeText } from './sanitize';

interface GenUIWidgetRendererProps {
  readonly widget: PortalTabWidget;
}

function spanToColClass(span: number | undefined): string {
  const s = typeof span === 'number' ? Math.min(Math.max(span, 1), 12) : 6;
  if (s >= 12) return 'sm:col-span-12';
  if (s >= 8) return 'sm:col-span-8';
  if (s >= 6) return 'sm:col-span-6';
  if (s >= 4) return 'sm:col-span-4';
  return 'sm:col-span-3';
}

export function GenUIWidgetRenderer({
  widget,
}: GenUIWidgetRendererProps): ReactElement {
  const meta = getWidgetKindMetadata(widget.kind);
  const title = toSafeText(widget.title) || meta.displayLabel;
  const subtitle = toSafeText(widget.subtitle);
  // `genui_part` forwards to one of the 35 vetted AG-UI primitives; surface
  // which one so the preview is honest about what would render.
  const kindLabel =
    widget.kind === 'genui_part' && widget.genuiKind
      ? `${meta.displayLabel} · ${widget.genuiKind}`
      : meta.displayLabel;

  return (
    <div
      className={`col-span-12 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-4 ${spanToColClass(widget.span)}`}
      data-testid={`genui-widget-${widget.key}`}
      data-widget-kind={widget.kind}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-slate-800">{title}</span>
          {subtitle ? (
            <span className="text-xs text-slate-500">{subtitle}</span>
          ) : null}
        </div>
        <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
          {kindLabel}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        {toSafeText(meta.description)}
      </p>
    </div>
  );
}
