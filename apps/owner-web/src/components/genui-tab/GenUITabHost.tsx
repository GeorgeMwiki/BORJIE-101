'use client';

/**
 * GenUITabHost — renders an MD-authored dynamic `PortalTab` (the
 * "infinite dynamic tabs" feature, FE seam #4).
 *
 * The MD authors a new domain tab by talking to Mr. Mwikila; the
 * portal-genui engine generates a `PortalTab` (sections of typed fields +
 * widgets) and persists it (migration 0170 `portal_tabs`). This host RENDERS
 * that generated tab inside owner-web, driven entirely by the EXISTING
 * field/widget registries in `@borjie/portal-genui`:
 *
 *   - sections          → vertical bands (title + description)
 *   - section.fields[]  → <GenUIFieldRenderer> (controlled, registry-mapped)
 *   - section.widgets[] → <GenUIWidgetRenderer> (live-data + actions)
 *
 * K1b — the tab now ACTS, not just previews. In FETCHED mode (`tabId`):
 *   - fields are wrapped in a real <form>; when the tab declares
 *     `record.enabled` (or carries fields) a Submit button POSTs the collected
 *     values to `POST /api/v1/portal-genui/tabs/:id/records` (optimistic +
 *     success/error), then the records list refetches.
 *   - widgets resolve their schema `binding` to LIVE data and render
 *     schema-declared action buttons via the home-chat fulfillment endpoint.
 * In PREVIEW mode (`tab=…`, no id) the render stays an honest inert preview
 * (no tab id ⇒ no records / bindings to resolve).
 *
 * Two ways to supply the tab:
 *   - `tab={portalTab}`  — render a tab the caller already has (proposal
 *                          preview path, BEFORE persist).
 *   - `tabId="tab_…"`    — fetch the persisted tab from the gateway.
 *
 * Security: every schema string is sanitised via `toSafeText` (DOMPurify) —
 * CLAUDE.md "no raw HTML interpolation". Literal UI copy flows through `t()`
 * (owner-web locale-purity; `genuiTab` namespace). Bilingual: absolute toggle
 * — no en/sw mixing.
 */

import { useMemo, type ReactElement } from 'react';
import type { PortalTab, PortalTabSection } from '@borjie/portal-genui';

import { dictionaries } from '@/i18n/dictionaries';
import { makeT, type TFn } from '@/i18n/resolve';
import { tailStrings as S } from '@/i18n/strings/tail';
import { GenUIFieldRenderer } from './GenUIFieldRenderer';
import { GenUIWidgetRenderer } from './GenUIWidgetRenderer';
import { GenUIRecordsList } from './GenUIRecordsList';
import { useGenuiTab } from './use-genui-tab';
import { useGenuiFormState } from './use-genui-form-state';
import {
  readGenuiTabExtras,
  widgetExtrasFor,
  type GenuiTabExtras,
} from './genui-tab-extras';
import { GenUIFormContext } from './genui-form-context';
import { toSafeText } from './sanitize';

type Locale = 'en' | 'sw';

interface GenUITabHostBaseProps {
  readonly locale?: Locale;
}

interface GenUITabHostWithTab extends GenUITabHostBaseProps {
  readonly tab: PortalTab;
  readonly tabId?: never;
}

interface GenUITabHostWithId extends GenUITabHostBaseProps {
  readonly tabId: string;
  readonly tab?: never;
}

export type GenUITabHostProps = GenUITabHostWithTab | GenUITabHostWithId;

// ── Section ─────────────────────────────────────────────────────────

function SectionView({
  section,
  tabId,
  extras,
  t,
}: {
  readonly section: PortalTabSection;
  readonly tabId: string | null;
  readonly extras: GenuiTabExtras;
  readonly t: TFn;
}): ReactElement {
  const title = toSafeText(section.title);
  const description = toSafeText(section.description);
  return (
    <section
      className="flex flex-col gap-3"
      data-testid={`genui-section-${section.key}`}
    >
      <header className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="text-sm text-neutral-400">{description}</p>
        ) : null}
      </header>

      {section.fields.length > 0 ? (
        <div className="grid grid-cols-12 gap-4">
          {section.fields.map((field) => (
            <GenUIFieldRenderer key={field.key} field={field} tabId={tabId} />
          ))}
        </div>
      ) : null}

      {section.widgets.length > 0 ? (
        <div className="grid grid-cols-12 gap-4">
          {section.widgets.map((widget) => {
            const widgetExtras = widgetExtrasFor(extras, widget.key);
            return (
              <GenUIWidgetRenderer
                key={widget.key}
                widget={widget}
                t={t}
                tabId={tabId}
                binding={widgetExtras.binding}
                actions={widgetExtras.actions}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

// ── Submit bar (record persistence) ─────────────────────────────────

function SubmitBar({
  status,
  disabled,
  t,
}: {
  readonly status: ReturnType<typeof useGenuiFormState>['status'];
  readonly disabled: boolean;
  readonly t: TFn;
}): ReactElement {
  return (
    <div className="flex items-center gap-3 border-t border-border pt-4">
      <button
        type="submit"
        disabled={disabled}
        data-testid="genui-tab-submit"
        className="inline-flex items-center justify-center rounded-md border border-warning bg-warning-subtle/20 px-4 py-2 text-sm font-semibold text-warning transition-colors hover:bg-warning-subtle/30 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status.kind === 'submitting'
          ? t('genuiTab.submitting')
          : t('genuiTab.submit')}
      </button>
      {status.kind === 'success' ? (
        <span className="text-sm text-success" data-testid="genui-tab-submit-success">
          {t('genuiTab.submitSuccess')}
        </span>
      ) : null}
      {status.kind === 'error' ? (
        <span className="text-sm text-destructive" data-testid="genui-tab-submit-error">
          {t('genuiTab.submitError')}
        </span>
      ) : null}
    </div>
  );
}

// ── Tab body ────────────────────────────────────────────────────────

function TabBody({
  tab,
  raw,
  tabId,
  locale,
  t,
}: {
  readonly tab: PortalTab;
  readonly raw: Readonly<Record<string, unknown>> | null;
  readonly tabId: string | null;
  readonly locale: Locale;
  readonly t: TFn;
}): ReactElement {
  const title = toSafeText(tab.title);
  const description = toSafeText(tab.description);
  const extras = useMemo(() => readGenuiTabExtras(raw), [raw]);
  // Hooks must run unconditionally — the form bag exists in both modes; submit
  // is a no-op without a tabId.
  const form = useGenuiFormState(tab, tabId);

  // A tab "acts" (form persists + records list) only when fetched (has a tab
  // id) AND it declares record persistence OR carries at least one field.
  const hasFields = tab.sections.some((s) => s.fields.length > 0);
  const acts = tabId !== null && (extras.recordEnabled || hasFields);

  const formContextValue = useMemo(
    () => ({ values: form.values, setValue: form.setValue, disabled: form.disabled }),
    [form.values, form.setValue, form.disabled],
  );

  const sections = (
    <>
      {tab.sections.length > 0 ? (
        tab.sections.map((section) => (
          <SectionView
            key={section.key}
            section={section}
            tabId={tabId}
            extras={extras}
            t={t}
          />
        ))
      ) : (
        <p className="text-sm text-neutral-400">{S.genUITabHost.empty[locale]}</p>
      )}
    </>
  );

  return (
    <div
      className="flex flex-col gap-6 px-2 py-2"
      data-testid="genui-tab-host"
      data-tab-key={tab.tabKey}
      data-tab-domain={tab.domain}
    >
      <header className="flex flex-col gap-1 border-b border-border pb-4">
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
            {toSafeText(tab.domain)}
          </span>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        </div>
        {description ? (
          <p className="text-sm text-neutral-400">{description}</p>
        ) : null}
      </header>

      {acts ? (
        <GenUIFormContext.Provider value={formContextValue}>
          <form
            className="flex flex-col gap-6"
            data-testid="genui-tab-form"
            onSubmit={(e) => {
              e.preventDefault();
              form.submit();
            }}
          >
            {sections}
            <SubmitBar status={form.status} disabled={form.disabled} t={t} />
          </form>
        </GenUIFormContext.Provider>
      ) : (
        sections
      )}

      {tabId !== null ? <GenUIRecordsList tabId={tabId} t={t} /> : null}
    </div>
  );
}

// ── Empty / status states ───────────────────────────────────────────

function StatusNote({ children }: { readonly children: string }): ReactElement {
  return (
    <div
      className="flex min-h-[120px] items-center justify-center px-4 py-8 text-sm text-neutral-400"
      data-testid="genui-tab-host-status"
    >
      {children}
    </div>
  );
}

// ── Host ────────────────────────────────────────────────────────────

export function GenUITabHost(props: GenUITabHostProps): ReactElement {
  const locale: Locale = props.locale ?? 'en';
  // Build a locale-strict translator from the explicit prop (the host is
  // prop-driven; the cookie-reading `useT()` could disagree with the caller).
  const t = useMemo<TFn>(() => makeT(dictionaries[locale]), [locale]);

  // Direct-tab mode — render immediately (proposal preview path). The hook is
  // still called unconditionally below to satisfy rules-of-hooks; it no-ops
  // when no tabId is supplied.
  const fetchState = useGenuiTab('tab' in props ? null : props.tabId);

  if ('tab' in props && props.tab) {
    // Preview mode: no tab id ⇒ inert preview (no records / live bindings).
    return (
      <TabBody tab={props.tab} raw={null} tabId={null} locale={locale} t={t} />
    );
  }

  switch (fetchState.status) {
    case 'loading':
      return <StatusNote>{S.genUITabHost.loading[locale]}</StatusNote>;
    case 'not_found':
      return <StatusNote>{S.genUITabHost.notFound[locale]}</StatusNote>;
    case 'error':
      return (
        <StatusNote>{`${S.genUITabHost.errorPrefix[locale]} ${fetchState.message}`}</StatusNote>
      );
    case 'ready':
      return (
        <TabBody
          tab={fetchState.tab}
          raw={fetchState.raw}
          tabId={fetchState.tab.id}
          locale={locale}
          t={t}
        />
      );
    default:
      return <StatusNote>{S.genUITabHost.notFound[locale]}</StatusNote>;
  }
}
