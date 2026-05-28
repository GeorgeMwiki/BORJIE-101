'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, ChevronRight, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { cn, ThemeToggle } from '@borjie/design-system';
import { LanguageToggle } from '../LanguageToggle';
import { SignOutButton } from '../SignOutButton';

/**
 * TopBar — owner-portal sticky header.
 *
 * Mirrors LitFin's `BorrowerHeader` shape: breadcrumbs left, action
 * cluster right (chat trigger / notifications / language / sign-out).
 * Breadcrumbs derive from the current pathname so every route gets a
 * spine without per-page wiring. The ask-Borjie button dispatches the
 * existing `borjie-open-widget` window event consumed by the chat
 * widget mount, so any route can open the conversational surface.
 */

const SEGMENT_LABELS: Readonly<Record<string, { en: string; sw: string }>> = {
  '': { en: 'Home', sw: 'Nyumbani' },
  dashboard: { en: 'Dashboard', sw: 'Dashibodi' },
  cockpit: { en: 'Cockpit', sw: 'Mkurugenzi' },
  'master-brain': { en: 'Master Brain', sw: 'Akili Kuu' },
  lmbm: { en: 'LMBM', sw: 'Ramani ya Biashara' },
  ask: { en: 'Ask Borjie', sw: 'Uliza Borjie' },
  'portfolio-map': { en: 'Portfolio map', sw: 'Ramani ya kampuni' },
  sites: { en: 'Sites', sw: 'Migodi' },
  'site-cockpit': { en: 'Site cockpit', sw: 'Kituo cha mgodi' },
  licences: { en: 'Licences', sw: 'Leseni' },
  licence: { en: 'Licence', sw: 'Leseni' },
  documents: { en: 'Documents', sw: 'Hati' },
  'document-intelligence': { en: 'Document intelligence', sw: 'Akili ya hati' },
  people: { en: 'People', sw: 'Watu' },
  fleet: { en: 'Fleet', sw: 'Magari' },
  inventory: { en: 'Inventory', sw: 'Bidhaa' },
  geology: { en: 'Geology', sw: 'Jiolojia' },
  finance: { en: 'Finance', sw: 'Gharama' },
  sales: { en: 'Sales', sw: 'Mauzo' },
  treasury: { en: 'Treasury', sw: 'Hazina' },
  marketplace: { en: 'Marketplace', sw: 'Soko' },
  compliance: { en: 'Compliance', sw: 'Uzingatiaji' },
  safety: { en: 'Safety', sw: 'Usalama' },
  community: { en: 'Community', sw: 'Jamii' },
  reports: { en: 'Reports', sw: 'Ripoti' },
  group: { en: 'Group view', sw: 'Kampuni nyingi' },
  onboarding: { en: 'Onboarding', sw: 'Kuanza' },
  settings: { en: 'Settings', sw: 'Mipangilio' },
};

function humanise(segment: string): string {
  return segment
    .split('-')
    .map((word) => (word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join(' ');
}

function buildCrumbs(pathname: string | null, lang: 'sw' | 'en') {
  const segments = (pathname ?? '/').split('/').filter(Boolean);
  if (segments.length === 0) {
    const root = SEGMENT_LABELS[''];
    return [{ label: lang === 'sw' ? root!.sw : root!.en, href: '/' }];
  }
  let trail = '';
  return segments.map((segment) => {
    trail += `/${segment}`;
    const known = SEGMENT_LABELS[segment];
    const label = known ? (lang === 'sw' ? known.sw : known.en) : humanise(segment);
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
  const crumbs = useMemo(
    () => buildCrumbs(pathname, languagePreference),
    [pathname, languagePreference],
  );
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

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 items-center justify-between gap-4',
        'border-b border-border/60 bg-background/85 px-6 backdrop-blur-xl',
      )}
    >
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
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

      {/* Right cluster */}
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
          {languagePreference === 'sw' ? 'Uliza Borjie' : 'Ask Borjie'}
        </button>

        <button
          type="button"
          aria-label="Notifications"
          className="relative rounded-xl p-2 text-neutral-400 hover:bg-surface hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-signal-500" />
        </button>

        <div className="hidden h-6 w-px bg-border/60 sm:block" />

        <LanguageToggle initial={languagePreference} />
        <ThemeToggle locale={languagePreference} />

        <div className="ml-1 flex items-center gap-2.5">
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-xs font-semibold text-foreground">{fullName}</div>
            <div className="text-[10px] text-neutral-500">{tenantName}</div>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-signal-500 to-signal-700 text-xs font-semibold text-background">
            {initials}
          </div>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
