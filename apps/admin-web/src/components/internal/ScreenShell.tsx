import type { ReactNode } from 'react';
import { PageHeader } from '@borjie/design-system';
import type { InternalScreen } from '@/lib/internal/screens';
import { pickByLocale, type Locale } from '@/lib/locale-shared';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

interface ScreenShellProps {
  readonly screen: InternalScreen;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
  readonly stub?: boolean;
  /**
   * Server-resolved active locale. When omitted, ScreenShell resolves it
   * from the `borjie_locale` cookie itself so its chrome never renders in a
   * different language than the AdminShell around it.
   */
  readonly locale?: Locale;
}

const STRINGS = {
  console: { en: 'Console', sw: 'Konsoli' },
  stubFooter: {
    en: 'Stub page — data above is illustrative. Wire to live services in subsequent build phases.',
    sw: 'Ukurasa wa awali — data hapo juu ni ya mfano. Itaunganishwa na huduma hai katika awamu zinazofuata za ujenzi.',
  },
} as const;

/**
 * Common header + container for every I-W-XX stub page. The header now
 * routes through the design-system `PageHeader` (breadcrumb + title +
 * description + actions), with the screen-id eyebrow kept above it (a
 * console affordance `PageHeader` does not model). The public API
 * (`screen, children, actions, stub`) is unchanged so every page-level
 * file keeps compiling verbatim and stays under the route budget.
 *
 * SINGLE LANGUAGE PER LOCALE (canon): the shell-owned chrome (the breadcrumb
 * "Console" root and the stub footer) renders in the server-resolved active
 * locale — never English chrome over a Swahili AdminShell. The screen title and
 * intent also render in that active locale (`screen.titleI18n` /
 * `screen.intentI18n` resolved via `pickByLocale`) so the whole header is one
 * language, never an English title over a Swahili breadcrumb.
 */
export async function ScreenShell({
  screen,
  children,
  actions,
  stub = false,
  locale,
}: ScreenShellProps): Promise<JSX.Element> {
  const activeLocale = locale ?? (await readLocaleFromServerCookies());
  return (
    <main id="main-content" className="mx-auto max-w-7xl px-6 py-10">
      <p className="mb-1 text-caption uppercase tracking-widest text-signal-500">{screen.id}</p>
      <PageHeader
        title={pickByLocale(activeLocale, screen.titleI18n)}
        description={pickByLocale(activeLocale, screen.intentI18n)}
        breadcrumbs={[
          { label: pickByLocale(activeLocale, STRINGS.console), href: '/internal' },
          { label: screen.id },
        ]}
        actions={actions}
      />

      <section className="space-y-6">{children}</section>

      {stub ? (
        <footer className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
          {pickByLocale(activeLocale, STRINGS.stubFooter)}
        </footer>
      ) : null}
    </main>
  );
}
