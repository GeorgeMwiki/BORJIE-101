'use client';

/**
 * GenUITabHost — renders an MD-authored dynamic `PortalTab` (the
 * "infinite dynamic tabs" feature, FE seam #4).
 *
 * The MD authors a new domain tab by talking to Mr. Mwikila; the
 * portal-genui engine generates a `PortalTab` (sections of typed fields +
 * widgets) and persists it (migration 0170 `portal_tabs`). This host is what
 * RENDERS that generated tab inside owner-web, driven entirely by the
 * EXISTING field/widget registries in `@borjie/portal-genui`:
 *
 *   - sections          → vertical bands (title + description)
 *   - section.fields[]  → <GenUIFieldRenderer> (22 field kinds, registry-mapped)
 *   - section.widgets[] → <GenUIWidgetRenderer> (14 widget kinds, registry-mapped)
 *
 * Two ways to supply the tab:
 *   - `tab={portalTab}`  — render a tab the caller already has (e.g. the
 *                          preview from a brain `tab_proposal` chip BEFORE
 *                          persist).
 *   - `tabId="tab_…"`    — fetch the persisted tab from the gateway.
 *
 * Security: every string the tab carries is sanitised to plain text via
 * `toSafeText` (DOMPurify, all tags stripped) — CLAUDE.md "no raw HTML
 * interpolation". The tab itself was zod-validated by the engine before
 * persist, and re-validated on fetch (`safeParsePortalTab`).
 *
 * Bilingual: loading / empty copy honours the active locale (absolute
 * toggle — no en/sw mixing).
 */

import { type ReactElement } from 'react';
import type { PortalTab, PortalTabSection } from '@borjie/portal-genui';

import { GenUIFieldRenderer } from './GenUIFieldRenderer';
import { GenUIWidgetRenderer } from './GenUIWidgetRenderer';
import { useGenuiTab } from './use-genui-tab';
import { toSafeText } from './sanitize';

type Locale = 'en' | 'sw';

const COPY: Record<
  Locale,
  {
    readonly loading: string;
    readonly notFound: string;
    readonly errorPrefix: string;
    readonly empty: string;
  }
> = {
  en: {
    loading: 'Loading tab…',
    notFound: 'This tab is no longer available.',
    errorPrefix: 'Could not load this tab:',
    empty: 'This tab has no sections yet.',
  },
  sw: {
    loading: 'Inapakia kichupo…',
    notFound: 'Kichupo hiki hakipatikani tena.',
    errorPrefix: 'Imeshindwa kupakia kichupo hiki:',
    empty: 'Kichupo hiki bado hakina sehemu.',
  },
};

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
}: {
  readonly section: PortalTabSection;
}): ReactElement {
  const title = toSafeText(section.title);
  const description = toSafeText(section.description);
  return (
    <section
      className="flex flex-col gap-3"
      data-testid={`genui-section-${section.key}`}
    >
      <header className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold text-slate-800">{title}</h3>
        {description ? (
          <p className="text-sm text-slate-500">{description}</p>
        ) : null}
      </header>

      {section.fields.length > 0 ? (
        <div className="grid grid-cols-12 gap-4">
          {section.fields.map((field) => (
            <GenUIFieldRenderer key={field.key} field={field} />
          ))}
        </div>
      ) : null}

      {section.widgets.length > 0 ? (
        <div className="grid grid-cols-12 gap-4">
          {section.widgets.map((widget) => (
            <GenUIWidgetRenderer key={widget.key} widget={widget} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ── Tab body (pure render of a known tab) ───────────────────────────

function TabBody({
  tab,
  locale,
}: {
  readonly tab: PortalTab;
  readonly locale: Locale;
}): ReactElement {
  const title = toSafeText(tab.title);
  const description = toSafeText(tab.description);
  return (
    <div
      className="flex flex-col gap-6 px-2 py-2"
      data-testid="genui-tab-host"
      data-tab-key={tab.tabKey}
      data-tab-domain={tab.domain}
    >
      <header className="flex flex-col gap-1 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            {toSafeText(tab.domain)}
          </span>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        </div>
        {description ? (
          <p className="text-sm text-slate-500">{description}</p>
        ) : null}
      </header>

      {tab.sections.length > 0 ? (
        tab.sections.map((section) => (
          <SectionView key={section.key} section={section} />
        ))
      ) : (
        <p className="text-sm text-slate-500">{COPY[locale].empty}</p>
      )}
    </div>
  );
}

// ── Empty / status states ───────────────────────────────────────────

function StatusNote({ children }: { readonly children: string }): ReactElement {
  return (
    <div
      className="flex min-h-[120px] items-center justify-center px-4 py-8 text-sm text-slate-500"
      data-testid="genui-tab-host-status"
    >
      {children}
    </div>
  );
}

// ── Host ────────────────────────────────────────────────────────────

export function GenUITabHost(props: GenUITabHostProps): ReactElement {
  const locale: Locale = props.locale ?? 'en';

  // Direct-tab mode — render immediately (proposal preview path). Hook is
  // still called unconditionally below to satisfy the rules-of-hooks; it
  // no-ops when no tabId is supplied.
  const fetchState = useGenuiTab('tab' in props ? null : props.tabId);

  if ('tab' in props && props.tab) {
    return <TabBody tab={props.tab} locale={locale} />;
  }

  switch (fetchState.status) {
    case 'loading':
      return <StatusNote>{COPY[locale].loading}</StatusNote>;
    case 'not_found':
      return <StatusNote>{COPY[locale].notFound}</StatusNote>;
    case 'error':
      return (
        <StatusNote>{`${COPY[locale].errorPrefix} ${fetchState.message}`}</StatusNote>
      );
    case 'ready':
      return <TabBody tab={fetchState.tab} locale={locale} />;
    default:
      return <StatusNote>{COPY[locale].notFound}</StatusNote>;
  }
}
