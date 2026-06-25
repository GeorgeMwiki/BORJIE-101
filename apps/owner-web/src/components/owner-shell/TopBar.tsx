'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, ChevronRight, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { cn, ThemeToggle } from '@borjie/design-system';
import { AppTopBar } from '@borjie/app-shell';
import { LanguageToggle } from '../LanguageToggle';
import { SignOutButton } from '../SignOutButton';
import { useT } from '@/i18n/t.client';
import type { TFn } from '@/i18n/resolve';
import { requirePublicBaseUrl } from '@/lib/env-guard';

// Resolved once at module load (NEXT_PUBLIC_* are statically inlined by
// Next). In production builds requirePublicBaseUrl throws when the env
// var is unset — a loud boot failure beats a dead portal-switch link.
const OWNER_URL = requirePublicBaseUrl(
  'NEXT_PUBLIC_OWNER_WEB_ORIGIN',
  'http://localhost:3010',
);
const ADMIN_URL = requirePublicBaseUrl(
  'NEXT_PUBLIC_ADMIN_WEB_ORIGIN',
  'http://localhost:3020',
);

/**
 * TopBar — owner-portal sticky header.
 *
 * Mirrors the reference portal-header shape: breadcrumbs left, action
 * cluster right (chat trigger / notifications / language / sign-out).
 * Breadcrumbs derive from the current pathname so every route gets a
 * spine without per-page wiring. The ask-Borjie button dispatches the
 * existing `borjie-open-widget` window event consumed by the chat
 * widget mount, so any route can open the conversational surface.
 */

// Path segment → dictionary key. Segments missing here fall back to a
// humanised English-ish label (path text, locale-neutral).
const SEGMENT_KEYS: Readonly<Record<string, string>> = {
  '': 'nav.home',
  dashboard: 'nav.dashboard',
  cockpit: 'nav.cockpit',
  'master-brain': 'nav.masterBrain',
  lmbm: 'nav.lmbm',
  ask: 'nav.ask',
  'portfolio-map': 'nav.portfolioMap',
  sites: 'nav.sites',
  'site-cockpit': 'nav.siteCockpit',
  licences: 'nav.licences',
  licence: 'nav.licence',
  documents: 'nav.documents',
  'document-intelligence': 'nav.documentIntelligence',
  people: 'nav.people',
  fleet: 'nav.fleet',
  inventory: 'nav.inventory',
  geology: 'nav.geology',
  finance: 'nav.finance',
  sales: 'nav.sales',
  treasury: 'nav.treasury',
  marketplace: 'nav.marketplace',
  compliance: 'nav.compliance',
  safety: 'nav.safety',
  community: 'nav.community',
  reports: 'nav.reports',
  group: 'nav.groupView',
  onboarding: 'nav.onboarding',
  settings: 'nav.settings',
};

function humanise(segment: string): string {
  return segment
    .split('-')
    .map((word) => (word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join(' ');
}

function buildCrumbs(pathname: string | null, t: TFn) {
  const segments = (pathname ?? '/').split('/').filter(Boolean);
  if (segments.length === 0) {
    return [{ label: t('nav.home'), href: '/' }];
  }
  let trail = '';
  return segments.map((segment) => {
    trail += `/${segment}`;
    const key = SEGMENT_KEYS[segment];
    const label = key ? t(key) : humanise(segment);
    return { label, href: trail };
  });
}

interface TopBarProps {
  readonly fullName: string;
  readonly tenantName: string;
  readonly languagePreference: 'sw' | 'en';
}

export function TopBar({ fullName, tenantName, languagePreference }: TopBarProps) {
  const pathname = usePathname();
  // Seed useT from the server-resolved languagePreference so the breadcrumb
  // spine + action labels render the SAME language as the SSR `<html lang>`
  // chrome on the first paint (no EN-under-SW split-brain frame).
  const t = useT(languagePreference);
  const crumbs = useMemo(() => buildCrumbs(pathname, t), [pathname, t]);
  const initials = useMemo(
    () =>
      fullName
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0])
        .join('')
        .toUpperCase(),
    [fullName],
  );

  function handleAskBorjie() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('borjie-open-widget'));
  }

  // Localized portal-switcher labels — injected into the headless
  // @borjie/app-shell so EN/SW never mix (the shell hard-codes nothing).
  const portalLabels = useMemo(
    () => ({
      owner: t('portal.owner'),
      admin: t('portal.admin'),
      switch: t('portal.switch'),
    }),
    [t],
  );

  // Left slot — the route breadcrumb spine.
  const breadcrumbs = (
    <nav aria-label={t('common.breadcrumb')} className="flex min-w-0 items-center gap-2 text-sm">
      <ol className="flex min-w-0 items-center gap-1.5">
        {crumbs.map((crumb, idx) => {
          const last = idx === crumbs.length - 1;
          return (
            <li key={crumb.href} className="flex min-w-0 items-center gap-1.5">
              {idx > 0 ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-500" aria-hidden />
              ) : null}
              {last ? (
                <span
                  aria-current="page"
                  className="truncate text-sm font-semibold text-foreground"
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="truncate text-sm text-neutral-400 hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );

  // Right slot — the cockpit action cluster, now living inside the
  // suite-wide AppTopBar so locale + theme toggles travel with the
  // portal switcher across owner-web and admin-web.
  const actions = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleAskBorjie}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold',
          'bg-signal-500 text-background shadow-sm transition-colors hover:bg-signal-400',
        )}
      >
        <Sparkles className="h-3.5 w-3.5" />
        {t('nav.ask')}
      </button>

      <Link
        href="/notifications"
        aria-label={t('nav.notifications')}
        className="relative rounded-xl p-2 text-neutral-400 hover:bg-surface hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-signal-500" />
      </Link>

      <div className="hidden h-6 w-px bg-border/60 sm:block" />

      <LanguageToggle initial={languagePreference} />
      <ThemeToggle locale={languagePreference} />

      <div className="ml-1 flex items-center gap-2.5">
        <div className="hidden text-right leading-tight sm:block">
          <div className="text-xs font-semibold text-foreground">{fullName}</div>
          <div className="text-tiny text-neutral-500">{tenantName}</div>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-signal-500 to-signal-700 text-xs font-semibold text-background">
          {initials}
        </div>
        <SignOutButton lang={languagePreference} />
      </div>
    </div>
  );

  return (
    <AppTopBar
      current="owner"
      ownerUrl={OWNER_URL}
      adminUrl={ADMIN_URL}
      labels={portalLabels}
      brand={breadcrumbs}
      actions={actions}
      className={cn(
        'sticky top-0 z-30 flex h-14 items-center gap-4',
        'border-b border-border/60 bg-background/85 px-6 backdrop-blur-xl',
      )}
    />
  );
}
