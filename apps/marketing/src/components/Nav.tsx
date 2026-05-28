'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  Pickaxe,
  Mountain,
  Gem,
  Coins,
  Building2,
  Factory,
  Landmark,
  Users,
  Wallet,
  Menu,
  X,
  FileText,
  HelpCircle,
} from 'lucide-react';
import { LanguageToggle } from './LanguageToggle';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * Marketing-site top navigation — LitFin MainNav parity, ported to the
 * Borjie navy + gold palette and the Tanzanian-mining audience set.
 *
 * Composition:
 *   - Scroll-aware shell with a subtle backdrop-blur transition once the
 *     user scrolls past 20px (mirrors LitFin's `scrolled` state).
 *   - Brand wordmark on the left.
 *   - Inline "Who we serve" mega-menu with 4 audience columns
 *     (operators, buyers, ecosystem, capital). Each column shows the
 *     mining-audience entries with a lucide icon tile and a one-line
 *     description.
 *   - Always-visible: Pricing, Docs.
 *   - Right-side: Locale toggle, Sign-in, primary CTA "Request a pilot".
 *   - Mobile drawer with the full audience matrix collapsed.
 *
 * Stays bilingual — every label resolves through `getMessages(locale).nav`.
 */

interface AudienceItem {
  readonly id: string;
  readonly href: string;
  readonly icon: React.ComponentType<{
    readonly className?: string;
    readonly strokeWidth?: number;
    readonly 'aria-hidden'?: boolean;
  }>;
}

interface AudienceCategory {
  readonly titleKey:
    | 'operators'
    | 'buyers'
    | 'ecosystem'
    | 'capital';
  readonly items: readonly AudienceItem[];
}

const AUDIENCE_CATEGORIES: readonly AudienceCategory[] = [
  {
    titleKey: 'operators',
    items: [
      { id: 'pml', href: '/for-pml', icon: Pickaxe },
      { id: 'ml', href: '/for-ml', icon: Mountain },
      { id: 'sml', href: '/for-sml', icon: Gem },
    ],
  },
  {
    titleKey: 'buyers',
    items: [
      { id: 'buyers', href: '/buyers', icon: Coins },
      { id: 'smelters', href: '/for-smelters', icon: Factory },
    ],
  },
  {
    titleKey: 'ecosystem',
    items: [
      { id: 'cooperatives', href: '/for-cooperatives', icon: Users },
      { id: 'regulators', href: '/for-regulators', icon: Landmark },
    ],
  },
  {
    titleKey: 'capital',
    items: [
      { id: 'investors', href: '/for-investors', icon: Wallet },
    ],
  },
];

const RESOURCE_LINKS = [
  { labelKey: 'blog', href: '/blog', icon: FileText },
  { labelKey: 'support', href: '/docs', icon: HelpCircle },
] as const;

const ALL_AUDIENCE_HREFS = AUDIENCE_CATEGORIES.flatMap((c) =>
  c.items.map((i) => i.href),
);

interface WordmarkProps {
  readonly premium?: boolean;
}
function Wordmark({ premium = true }: WordmarkProps) {
  const tone = premium
    ? 'bg-gradient-to-r from-[oklch(0.86_0.16_80)] to-[oklch(0.58_0.12_65)] bg-clip-text text-transparent'
    : 'text-foreground';
  return (
    <span
      className={`font-display text-lg font-bold tracking-tight ${tone}`}
    >
      Borjie
    </span>
  );
}

export function Nav({ locale }: { readonly locale: Locale }) {
  const pathname = usePathname() ?? '/';
  const t = getMessages(locale).nav;
  const cats = t.categories;
  const items = t.items;

  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const audienceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handler, { passive: true });
    handler();
    return () => window.removeEventListener('scroll', handler);
  }, []);

  // Close audience dropdown on outside click
  useEffect(() => {
    if (!audienceOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        audienceRef.current &&
        !audienceRef.current.contains(e.target as Node)
      ) {
        setAudienceOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [audienceOpen]);

  const isOnAudiencePage = ALL_AUDIENCE_HREFS.includes(pathname);

  // Owner cockpit lives on a different origin (port 3010 in dev). The
  // marketing site never owns auth — Sign In + Pilot CTA both bounce to
  // owner-web. Env override lets prod point at the live cockpit.
  const ownerWebUrl =
    process.env['NEXT_PUBLIC_OWNER_WEB_URL'] ?? 'http://localhost:3010';
  const signInHref = `${ownerWebUrl}/sign-in`;
  const pilotHref = '/pilot';

  return (
    <nav
      className={[
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300 ease-out',
        scrolled
          ? 'border-b border-border/70 bg-background/85 shadow-[0_18px_50px_-12px_oklch(0.16_0.025_260/0.6)] backdrop-blur-2xl'
          : 'border-b border-border/30 bg-background/60 backdrop-blur-xl',
      ].join(' ')}
    >
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-2 px-4 sm:px-6">
        <Link
          href="/"
          aria-label="Borjie home"
          className="-ml-1 shrink-0 rounded-sm p-1 transition-opacity duration-fast hover:opacity-90"
        >
          <Wordmark premium />
        </Link>

        {/* Desktop nav — center cluster */}
        <div className="hidden items-center gap-1 lg:flex">
          {/* Who we serve mega-menu */}
          <div className="relative" ref={audienceRef}>
            <button
              type="button"
              onClick={() => setAudienceOpen((v) => !v)}
              className={[
                'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isOnAudiencePage
                  ? 'bg-signal-500/10 text-signal-500'
                  : 'text-neutral-400 hover:bg-surface-raised hover:text-foreground',
              ].join(' ')}
              aria-expanded={audienceOpen}
              aria-haspopup="true"
            >
              {t.whoWeServe}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${audienceOpen ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>
            {audienceOpen && (
              <div
                role="menu"
                className="absolute left-1/2 top-full mt-2 w-[720px] -translate-x-1/2 rounded-2xl border border-border/60 bg-card/95 p-4 shadow-[0_24px_80px_-20px_oklch(0.16_0.025_260/0.7)] backdrop-blur-2xl"
              >
                <div className="grid grid-cols-4 gap-3">
                  {AUDIENCE_CATEGORIES.map((cat) => (
                    <div key={cat.titleKey}>
                      <div className="mb-2.5 px-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                        {cats[cat.titleKey]}
                      </div>
                      <div className="space-y-0.5">
                        {cat.items.map((item) => {
                          const Icon = item.icon;
                          const isActive = pathname === item.href;
                          const titleKey =
                            item.id as keyof typeof items;
                          const descKey =
                            `${item.id}Desc` as keyof typeof items;
                          return (
                            <Link
                              key={item.id}
                              href={item.href}
                              onClick={() => setAudienceOpen(false)}
                              className={[
                                'flex items-start gap-2.5 rounded-xl p-2.5 transition-colors',
                                isActive
                                  ? 'bg-signal-500/10 text-signal-500'
                                  : 'hover:bg-surface-raised',
                              ].join(' ')}
                            >
                              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-signal-500/10 text-signal-500">
                                <Icon
                                  className="h-3.5 w-3.5"
                                  strokeWidth={1.75}
                                  aria-hidden
                                />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-sm font-medium leading-tight text-foreground">
                                  {items[titleKey]}
                                </span>
                                <span className="mt-0.5 block text-[11px] leading-tight text-neutral-400">
                                  {items[descKey]}
                                </span>
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Link
            href="/pricing"
            className={[
              'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              pathname === '/pricing'
                ? 'bg-signal-500/10 text-signal-500'
                : 'text-neutral-400 hover:bg-surface-raised hover:text-foreground',
            ].join(' ')}
          >
            {t.pricing}
          </Link>

          {RESOURCE_LINKS.map((link) => {
            const Icon = link.icon;
            const labelKey = link.labelKey as keyof typeof t;
            const label = (t[labelKey] as string) ?? link.labelKey;
            const isActive = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={[
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-signal-500/10 text-signal-500'
                    : 'text-neutral-400 hover:bg-surface-raised hover:text-foreground',
                ].join(' ')}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Link>
            );
          })}
        </div>

        {/* Right cluster */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden items-center rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-neutral-400 xl:inline-flex">
            Tanzania · TZS-first
          </span>
          <LanguageToggle current={locale} />
          <a
            href={signInHref}
            className="hidden rounded-xl px-3 py-2 text-sm font-medium text-neutral-400 transition-colors hover:bg-surface-raised hover:text-foreground sm:inline-block"
          >
            {t.signIn}
          </a>
          <Link
            href={pilotHref}
            className="hidden h-9 items-center gap-1.5 rounded-xl bg-signal-500 px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-fast ease-out hover:bg-signal-400 hover:shadow-md active:scale-[0.98] sm:inline-flex"
          >
            {t.requestPilot}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-xl border border-border/60 bg-background/70 p-2 transition-colors hover:bg-surface-raised lg:hidden"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? (
              <X className="h-5 w-5 text-foreground" />
            ) : (
              <Menu className="h-5 w-5 text-foreground" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="max-h-[80vh] overflow-y-auto border-t border-border/60 bg-card/95 backdrop-blur-2xl lg:hidden">
          <div className="mx-auto max-w-7xl space-y-4 px-4 py-4">
            {AUDIENCE_CATEGORIES.map((cat) => (
              <div key={cat.titleKey}>
                <div className="mb-2 px-4 font-mono text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  {cats[cat.titleKey]}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {cat.items.map((item) => {
                    const Icon = item.icon;
                    const titleKey = item.id as keyof typeof items;
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm text-neutral-300 transition-colors hover:bg-surface-raised hover:text-foreground"
                      >
                        <Icon className="h-4 w-4" aria-hidden />
                        <span>{items[titleKey]}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="border-t border-border/60 pt-2" />

            <Link
              href="/pricing"
              onClick={() => setMobileOpen(false)}
              className="block rounded-xl px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised"
            >
              {t.pricing}
            </Link>

            {RESOURCE_LINKS.map((link) => {
              const Icon = link.icon;
              const labelKey = link.labelKey as keyof typeof t;
              const label = (t[labelKey] as string) ?? link.labelKey;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised"
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </Link>
              );
            })}

            <div className="border-t border-border/60 pt-2" />

            <div className="grid gap-2">
              <Link
                href={pilotHref}
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-signal-500 px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-fast hover:bg-signal-400 hover:shadow-md active:scale-[0.98]"
              >
                {t.requestPilot}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
              <a
                href={signInHref}
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-border/60 px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised"
              >
                {t.signIn}
              </a>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
