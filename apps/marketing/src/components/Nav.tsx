'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ChevronDown,
  Menu,
  Pickaxe,
  Mountain,
  Gem,
  Coins,
  Factory,
  Landmark,
  Users,
  Wallet,
  Building2,
  Briefcase,
  HeartHandshake,
} from 'lucide-react';
import { LanguageToggle } from './LanguageToggle';
import { requirePublicBaseUrl } from '@/lib/env-guard';
import { getMessages, type Locale } from '@/lib/i18n';
import { BorjieLogo, ThemeToggle } from '@borjie/design-system';
import { useScrolled } from './nav/useScrolled';
import { AudienceMenu } from './nav/AudienceMenu';
import { MobileDrawer } from './nav/MobileDrawer';
import type { AudienceCategory, PrimaryLink } from './nav/types';

/**
 * Marketing-site top navigation.
 *
 * A lean flagship header in the Stripe / Linear / Vercel mould: the
 * Borjie lockup on the left, a small set of primary links, and one
 * filled primary CTA on the right. Auth and locale controls sit in a
 * compact right cluster; the dense audience matrix is progressively
 * disclosed behind a single "Who we serve" panel (desktop) or the
 * mobile drawer.
 *
 * The structural pieces — scroll state, focus-trap, the audience panel,
 * and the mobile sheet — live in `./nav/*` so this file stays the lean
 * composition root. Every label resolves through `getMessages(locale)`
 * so the nav is single-language per active locale.
 */

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
      { id: 'smelters', href: '/for-off-taker', icon: Factory },
    ],
  },
  {
    titleKey: 'ecosystem',
    items: [
      { id: 'cooperatives', href: '/for-cooperatives', icon: Users },
      { id: 'csrCommunity', href: '/for-csr-community', icon: HeartHandshake },
      { id: 'regulators', href: '/for-regulator', icon: Landmark },
    ],
  },
  {
    titleKey: 'capital',
    items: [
      { id: 'investors', href: '/for-investor', icon: Wallet },
      { id: 'bank', href: '/for-bank', icon: Building2 },
      { id: 'familyOffice', href: '/for-family-office', icon: Briefcase },
    ],
  },
];

const ALL_AUDIENCE_HREFS = AUDIENCE_CATEGORIES.flatMap((c) =>
  c.items.map((i) => i.href),
);

const PRIMARY_LINKS: readonly PrimaryLink[] = [
  { href: '/pricing', labelKey: 'pricing' },
  { href: '/buyers', labelKey: 'buyers' },
  { href: '/docs', labelKey: 'docs' },
];

/**
 * Still, deliberate lockup — the nav mark never breathes (the warm
 * bloom pulse is reserved for the hero). `pulse={false}` freezes it.
 */
function NavLockup() {
  return (
    <BorjieLogo
      variant="lockup-horizontal"
      size={28}
      tone="full"
      pulse={false}
      // Wordmark follows the surface foreground so it stays legible on the
      // light nav (the full-tone cream wordmark is built for dark backdrops);
      // the gold mark keeps its tone.
      wordmarkColor="currentColor"
    />
  );
}

export function Nav({ locale }: { readonly locale: Locale }) {
  const pathname = usePathname() ?? '/';
  const t = getMessages(locale).nav;

  const scrolled = useScrolled(8);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const audienceRef = useRef<HTMLDivElement>(null);
  const audienceButtonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const closeAudience = useCallback(() => setAudienceOpen(false), []);

  // Audience panel: close on outside click + Escape, return focus to
  // the trigger so a keyboard user is never stranded.
  useEffect(() => {
    if (!audienceOpen) return undefined;
    const onPointer = (e: MouseEvent) => {
      if (audienceRef.current && !audienceRef.current.contains(e.target as Node)) {
        setAudienceOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAudienceOpen(false);
        audienceButtonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [audienceOpen]);

  // Close any open panel when the route changes.
  useEffect(() => {
    setAudienceOpen(false);
    setMobileOpen(false);
  }, [pathname]);

  // Mutual exclusion with the floating concierge chat: the moment a nav overlay
  // (the "Who we serve" mega-menu or the mobile drawer) opens, close the chat so
  // the two large overlays never sit on top of each other. The chat reopens from
  // its own FAB; opening the chat in turn closes the menu via its outside-click.
  useEffect(() => {
    if ((audienceOpen || mobileOpen) && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('bn-litfin-close-chat'));
    }
  }, [audienceOpen, mobileOpen]);

  const isOnAudiencePage = ALL_AUDIENCE_HREFS.includes(pathname);

  // The marketing site never owns auth — Sign in bounces to owner-web's
  // canonical /sign-in. `requirePublicBaseUrl` throws in production when
  // the origin is unset so the deployed site can never link to localhost.
  const ownerWebUrl = requirePublicBaseUrl(
    'NEXT_PUBLIC_OWNER_WEB_ORIGIN',
    'http://localhost:3010',
  );
  const signInHref = `${ownerWebUrl}/sign-in`;
  // Self-serve sign-up is a real marketing-owned route, so it stays an
  // internal <Link>. It is the single primary CTA.
  const ctaHref = '/sign-up';

  const linkBase =
    'rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

  function linkClass(active: boolean) {
    return [
      linkBase,
      active
        ? 'text-signal-500'
        : 'text-foreground/70 hover:bg-surface-raised hover:text-foreground',
    ].join(' ');
  }

  return (
    <header
      className={[
        // ── Marketing global z-ladder (single source of truth) ──────────
        //   z-[70]  ScrollProgressBar  (top hairline, pointer-events-none)
        //   z-[60]  THIS nav  + its mega-menu (z-[60] local) + mobile drawer
        //   z-50    floating chat widget (FAB + open panel, @borjie/chat-ui)
        //   z-40    cookie consent
        //    0      page content
        // The nav is `isolate` so it is its own stacking context; raising it
        // to z-[60] lifts the WHOLE nav — bar, "Who we serve" panel, and the
        // mobile drawer — above the ambient chat widget. Previously the nav
        // sat at z-50 = the widget, and the widget (later in the DOM) painted
        // OVER any open menu, so a summoned overlay lost to the FAB ("no clear
        // order which comes up first").
        'fixed inset-x-0 top-0 z-[60] isolate transition-[background-color,border-color,box-shadow] duration-200 ease-out',
        scrolled
          ? 'border-b border-border bg-background/80 shadow-sm backdrop-blur-xl supports-[backdrop-filter]:bg-background/70'
          : 'border-b border-transparent bg-background/50 backdrop-blur-md',
      ].join(' ')}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 max-w-container items-center justify-between gap-4 px-4 sm:px-6"
      >
        {/* Brand */}
        <Link
          href="/"
          aria-label="Borjie home"
          className="-ml-1 inline-flex shrink-0 items-center rounded-md p-1 text-foreground transition-opacity duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <NavLockup />
        </Link>

        {/* Desktop primary links */}
        <div className="hidden items-center gap-1 lg:flex">
          <div className="relative" ref={audienceRef}>
            <button
              ref={audienceButtonRef}
              type="button"
              onClick={() => setAudienceOpen((v) => !v)}
              aria-expanded={audienceOpen}
              aria-haspopup="true"
              aria-controls={panelId}
              className={[
                linkBase,
                'inline-flex items-center gap-1',
                isOnAudiencePage || audienceOpen
                  ? 'text-signal-500'
                  : 'text-foreground/70 hover:bg-surface-raised hover:text-foreground',
              ].join(' ')}
            >
              {t.whoWeServe}
              <ChevronDown
                className={[
                  'h-3.5 w-3.5 transition-transform duration-200 ease-out',
                  audienceOpen ? 'rotate-180' : '',
                ].join(' ')}
                aria-hidden
              />
            </button>
            <AudienceMenu
              id={panelId}
              open={audienceOpen}
              onClose={closeAudience}
              categories={AUDIENCE_CATEGORIES}
              messages={t}
              pathname={pathname}
            />
          </div>

          {PRIMARY_LINKS.map((link) => {
            const active =
              link.href === '/'
                ? pathname === '/'
                : pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link key={link.href} href={link.href} className={linkClass(active)}>
                {t[link.labelKey]}
              </Link>
            );
          })}
        </div>

        {/* Right cluster */}
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-2 md:flex">
            <LanguageToggle current={locale} />
            <ThemeToggle locale={locale} />
          </div>
          <a
            href={signInHref}
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-foreground/70 transition-colors duration-150 ease-out hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:inline-block"
          >
            {t.signIn}
          </a>
          <Link
            href={ctaHref}
            className="hidden h-9 items-center rounded-lg bg-signal-500 px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors duration-150 ease-out hover:bg-signal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:inline-flex"
          >
            {t.requestPilot}
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label={t.openMenu}
            aria-expanded={mobileOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-foreground transition-colors duration-150 ease-out hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </nav>

      <MobileDrawer
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        categories={AUDIENCE_CATEGORIES}
        primaryLinks={PRIMARY_LINKS}
        messages={t}
        locale={locale}
        pathname={pathname}
        signInHref={signInHref}
        ctaHref={ctaHref}
      />
    </header>
  );
}
