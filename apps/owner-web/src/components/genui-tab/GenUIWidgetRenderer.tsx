'use client';

/**
 * GenUIWidgetRenderer — renders ONE generated `PortalTabWidget` using the
 * EXISTING widget catalog from `@borjie/portal-genui` (widgets/registry).
 *
 * K1b — the widget now ACTS:
 *   - when it carries a schema-declared `binding` (kind query/tool) the data
 *     is resolved via the SINGLE `useGenuiWidgetData(binding)` hook and the
 *     REAL result is rendered shaped by widget kind (table → rows, kpi_card →
 *     value, timeline → items). No per-widget code path.
 *   - with NO binding the card keeps the placeholder but LABELS it clearly so
 *     the preview is honest.
 *   - any schema-declared `action` button dispatches `{ verb, params }` to the
 *     SAME fulfillment endpoint home-chat uses
 *     (`POST /api/v1/owner/chat/confirm-action`); `deferToBrain` renders a
 *     "handling it" note instead of a dead click.
 *
 * genui_part fix (owner-genui-1): a `kind === 'genui_part'` widget embeds one
 * of the 35 vetted AG-UI primitives from `@borjie/genui`. The dispatch is
 * fully GENERATIVE inside AdaptiveRenderer's existing switch — no per-kind
 * branch here. The rich payload lives in `widget.config.initialProps`
 * (the static AgUiUiPart authored by the brain), optionally merged with any
 * resolved binding rows. The verdict's fixNote: adapter reads
 * `widget.config.initialProps` via `parseWidgetConfig`, NOT the binding
 * response. AdaptiveRenderer handles unknown kinds via UnknownKindCard.
 *
 * Everything is generative + locale-pure: literal copy flows through the
 * injected `t()` (owner-web locale-purity is enforced); schema-authored
 * strings are sanitised via `toSafeText` (CLAUDE.md: no raw HTML).
 */

import { useCallback, useState, type ReactElement } from 'react';
import {
  getWidgetKindMetadata,
  parseWidgetConfig,
  type PortalTabWidget,
} from '@borjie/portal-genui';
import { AdaptiveRenderer } from '@borjie/genui';
import type { AgUiUiPart } from '@borjie/genui';
import { reportGenuiUnknownKind } from '../../lib/genui-telemetry';
import type { TFn } from '@/i18n/resolve';
import { confirmAction } from '@/lib/queries/chat-actions';

import { toSafeText } from './sanitize';
import {
  useGenuiWidgetData,
  type GenuiWidgetBinding,
  type GenuiWidgetData,
} from './use-genui-widget-data';
import type { GenuiAction } from './genui-tab-extras';

interface GenUIWidgetRendererProps {
  readonly widget: PortalTabWidget;
  /** Bound translator from the host (locale-strict). */
  readonly t: TFn;
  /** Tab id — present in fetched-tab mode, null in preview mode. */
  readonly tabId: string | null;
  /** Schema-declared data binding, or null (placeholder). */
  readonly binding: GenuiWidgetBinding | null;
  /** Schema-declared action buttons (possibly empty). */
  readonly actions: ReadonlyArray<GenuiAction>;
}

function spanToColClass(span: number | undefined): string {
  const s = typeof span === 'number' ? Math.min(Math.max(span, 1), 12) : 6;
  if (s >= 12) return 'sm:col-span-12';
  if (s >= 8) return 'sm:col-span-8';
  if (s >= 6) return 'sm:col-span-6';
  if (s >= 4) return 'sm:col-span-4';
  return 'sm:col-span-3';
}

// ── Cell coercion (read whatever the server returned, render as text) ──────

function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return toSafeText(String(value));
}

// ── Kind-shaped data views ─────────────────────────────────────────────────

function TableView({
  data,
  t,
}: {
  readonly data: GenuiWidgetData;
  readonly t: TFn;
}): ReactElement {
  const rows = Array.isArray(data.rows) ? (data.rows as unknown[]) : [];
  const declaredColumns = Array.isArray(data.columns)
    ? (data.columns as unknown[]).map((c) => String(c))
    : null;
  // Derive columns from the first row when the server did not declare them.
  const firstRow =
    rows.length > 0 && rows[0] && typeof rows[0] === 'object'
      ? (rows[0] as Record<string, unknown>)
      : {};
  const columns = declaredColumns ?? Object.keys(firstRow);

  if (rows.length === 0) {
    return <p className="text-xs text-neutral-400">{t('genuiTab.widgetEmpty')}</p>;
  }
  return (
    <div className="overflow-x-auto" data-testid="genui-widget-table">
      <table className="w-full border-collapse text-left text-xs">
        {columns.length > 0 ? (
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  className="border-b border-border px-2 py-1 font-medium text-neutral-300"
                >
                  {toSafeText(col)}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {rows.map((row, rowIdx) => {
            const record =
              row && typeof row === 'object'
                ? (row as Record<string, unknown>)
                : {};
            return (
              <tr key={rowIdx} className="border-b border-border/50">
                {columns.map((col) => (
                  <td key={col} className="px-2 py-1 text-neutral-200">
                    {cellText(record[col])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function KpiView({
  data,
  t,
}: {
  readonly data: GenuiWidgetData;
  readonly t: TFn;
}): ReactElement {
  const value =
    data.value != null
      ? cellText(data.value)
      : '';
  const unit = typeof data.unit === 'string' ? toSafeText(data.unit) : '';
  const label =
    typeof data.label === 'string'
      ? toSafeText(data.label)
      : t('genuiTab.widgetValueLabel');
  if (!value) {
    return <p className="text-xs text-neutral-400">{t('genuiTab.widgetEmpty')}</p>;
  }
  return (
    <div className="flex flex-col gap-0.5" data-testid="genui-widget-kpi">
      <span className="text-2xl font-semibold text-foreground">
        {value}
        {unit ? <span className="ml-1 text-sm text-neutral-400">{unit}</span> : null}
      </span>
      <span className="text-xs text-neutral-400">{label}</span>
    </div>
  );
}

function TimelineView({
  data,
  t,
}: {
  readonly data: GenuiWidgetData;
  readonly t: TFn;
}): ReactElement {
  const items = Array.isArray(data.items) ? (data.items as unknown[]) : [];
  if (items.length === 0) {
    return <p className="text-xs text-neutral-400">{t('genuiTab.widgetEmpty')}</p>;
  }
  return (
    <ol className="flex flex-col gap-2" data-testid="genui-widget-timeline">
      {items.map((item, idx) => {
        const record =
          item && typeof item === 'object'
            ? (item as Record<string, unknown>)
            : {};
        const title = cellText(record.title ?? record.label ?? item);
        const at = cellText(record.at ?? record.timestamp ?? record.date);
        return (
          <li key={idx} className="flex flex-col gap-0.5 border-l border-border pl-3">
            <span className="text-sm text-foreground">{title}</span>
            {at ? <span className="text-xs text-neutral-400">{at}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Generic fallback for bound widgets whose kind has no bespoke view. */
function GenericDataView({
  data,
  t,
}: {
  readonly data: GenuiWidgetData;
  readonly t: TFn;
}): ReactElement {
  if (Array.isArray(data.rows)) return <TableView data={data} t={t} />;
  if (Array.isArray(data.items)) return <TimelineView data={data} t={t} />;
  if (data.value != null) return <KpiView data={data} t={t} />;
  return <p className="text-xs text-neutral-400">{t('genuiTab.widgetEmpty')}</p>;
}

/**
 * Adapter that mounts AdaptiveRenderer for a `genui_part` widget.
 *
 * The payload is `widget.config.initialProps` — the static AgUiUiPart authored
 * by the brain at tab-generation time. It is parsed via parseWidgetConfig
 * (which runs the per-kind configSchema). The dispatch is entirely generative
 * inside AdaptiveRenderer — no per-genuiKind branch here.
 *
 * Per the verdict fixNote: use widget.config.initialProps, NOT the binding
 * response (which only carries tabular rows/value/items).
 */
function GenUiPartView({
  widget,
  t,
}: {
  readonly widget: PortalTabWidget;
  readonly t: TFn;
}): ReactElement {
  let uiPart: AgUiUiPart | null = null;
  try {
    const config = parseWidgetConfig(widget) as {
      initialProps?: Record<string, unknown>;
    } | null;
    const initialProps = config?.initialProps;
    if (initialProps && typeof initialProps === 'object' && typeof (initialProps as { kind?: unknown }).kind === 'string') {
      uiPart = initialProps as unknown as AgUiUiPart;
    }
  } catch {
    // parseWidgetConfig threw (malformed config) — degrade to placeholder.
    uiPart = null;
  }

  if (!uiPart) {
    return (
      <p
        className="text-xs leading-relaxed text-neutral-400"
        data-testid={`genui-widget-${widget.key}-placeholder`}
      >
        {t('genuiTab.widgetPlaceholder')}
      </p>
    );
  }

  return (
    <div data-testid={`genui-widget-${widget.key}-adaptive`}>
      <AdaptiveRenderer
        uiPart={uiPart}
        onUnknownKind={(detail) => reportGenuiUnknownKind(detail, 'owner-cockpit')}
      />
    </div>
  );
}

// ── Bound-data region ───────────────────────────────────────────────────────

function WidgetDataRegion({
  widget,
  tabId,
  binding,
  t,
}: {
  readonly widget: PortalTabWidget;
  readonly tabId: string | null;
  readonly binding: GenuiWidgetBinding;
  readonly t: TFn;
}): ReactElement {
  const query = useGenuiWidgetData({ tabId, widgetKey: widget.key, binding });
  if (query.isLoading) {
    return <p className="text-xs text-neutral-400">{t('genuiTab.widgetLoading')}</p>;
  }
  if (query.isError || !query.data) {
    return <p className="text-xs text-destructive">{t('genuiTab.widgetError')}</p>;
  }
  const data = query.data;
  switch (widget.kind) {
    case 'table':
      return <TableView data={data} t={t} />;
    case 'kpi_card':
    case 'gauge':
      return <KpiView data={data} t={t} />;
    case 'timeline':
    case 'calendar':
      return <TimelineView data={data} t={t} />;
    case 'genui_part':
      // The rich primitive payload lives in widget.config.initialProps, not the
      // binding response. Delegate to the generative adapter — the full dispatch
      // is inside AdaptiveRenderer's existing switch. Binding rows are available
      // in `data` for host-driven overrides in future, but the static config is
      // the primary payload.
      return <GenUiPartView widget={widget} t={t} />;
    default:
      return <GenericDataView data={data} t={t} />;
  }
}

// ── Action buttons ──────────────────────────────────────────────────────────

type ActionStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'done' }
  | { readonly kind: 'handling' }
  | { readonly kind: 'declined'; readonly reason: string }
  | { readonly kind: 'failed' };

function ActionButton({
  action,
  t,
}: {
  readonly action: GenuiAction;
  readonly t: TFn;
}): ReactElement {
  const [status, setStatus] = useState<ActionStatus>({ kind: 'idle' });
  const label = toSafeText(action.label) || action.verb;

  const onClick = useCallback(() => {
    setStatus({ kind: 'running' });
    void confirmAction({ verb: action.verb, params: action.params ?? {} })
      .then((result) => {
        if (result.executed) {
          setStatus({ kind: 'done' });
          return;
        }
        // GENERATIVE FULFILLMENT — the verb cleared the hard rails but has no
        // deterministic handler; the brain is taking it agentically.
        if (result.deferToBrain) {
          setStatus({ kind: 'handling' });
          return;
        }
        if (!result.authorized && result.reason) {
          setStatus({ kind: 'declined', reason: result.reason });
          return;
        }
        setStatus({ kind: 'failed' });
      })
      .catch(() => setStatus({ kind: 'failed' }));
  }, [action.verb, action.params]);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={status.kind === 'running'}
        data-testid={`genui-action-${action.id}`}
        className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-warning hover:text-warning disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status.kind === 'running' ? t('genuiTab.actionRunning') : label}
      </button>
      {status.kind === 'done' ? (
        <span className="text-xs text-success">{t('genuiTab.actionDone')}</span>
      ) : null}
      {status.kind === 'handling' ? (
        <span className="text-xs text-neutral-400">
          {t('genuiTab.actionHandlingIt')}
        </span>
      ) : null}
      {status.kind === 'declined' ? (
        <span className="text-xs text-warning">
          {t('genuiTab.actionDeclined', { reason: status.reason })}
        </span>
      ) : null}
      {status.kind === 'failed' ? (
        <span className="text-xs text-destructive">
          {t('genuiTab.actionFailed')}
        </span>
      ) : null}
    </div>
  );
}

// ── Widget shell ────────────────────────────────────────────────────────────

export function GenUIWidgetRenderer({
  widget,
  t,
  tabId,
  binding,
  actions,
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
      className={`col-span-12 flex flex-col gap-2 rounded-lg border border-border bg-surface/60 p-4 ${spanToColClass(widget.span)}`}
      data-testid={`genui-widget-${widget.key}`}
      data-widget-kind={widget.kind}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {subtitle ? (
            <span className="text-xs text-neutral-400">{subtitle}</span>
          ) : null}
        </div>
        <span className="shrink-0 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
          {kindLabel}
        </span>
      </div>

      {widget.kind === 'genui_part' ? (
        // genui_part: always render from widget.config.initialProps regardless of
        // whether a binding is present — the AdaptiveRenderer is the dispatch.
        <GenUiPartView widget={widget} t={t} />
      ) : binding ? (
        <WidgetDataRegion
          widget={widget}
          tabId={tabId}
          binding={binding}
          t={t}
        />
      ) : (
        // No binding — honest, clearly-labelled placeholder.
        <p
          className="text-xs leading-relaxed text-neutral-400"
          data-testid={`genui-widget-${widget.key}-placeholder`}
        >
          {t('genuiTab.widgetPlaceholder')}
        </p>
      )}

      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {actions.map((action) => (
            <ActionButton key={action.id} action={action} t={t} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
