'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BorjieLogo, Logomark } from '@borjie/design-system';
import { cn } from '@borjie/design-system';
import { useT } from '@/i18n/t.client';
import type { TFn } from '@/i18n/resolve';
import { SECTIONS, bestActiveHref } from './nav-sections';

/**
 * Owner-web sidebar — Portal pattern adapted to Borjie.
 *
 * Visual rules mirror `BorrowerSidebar` / `PortalSidebar`:
 *   1. Top: brand mark + tenant strapline.
 *   2. Sectioned nav with uppercase section labels and dashed dividers.
 *   3. Each item is a flex row — icon-glass tile on the left, label
 *      truncated in the middle, optional badge on the right.
 *   4. Active state shows a 3px primary pill flush to the left edge
 *      plus an `icon-glass-active` tile and `bg-primary/5` row.
 *
 * The nav model (`SECTIONS`) lives in `./nav-sections` so the desktop rail
 * and the below-`lg` `MobileNavDrawer` render the SAME routes — the
 * responsive collapse can never strand a route.
 *
 * RESPONSIVE: the desktop rail is `hidden lg:flex`, mirroring admin-web — it
 * is removed from the layout below `lg` (where it would otherwise eat a
 * 260px slice of a narrow viewport, SC 1.4.10). Below `lg` the same nav is
 * reachable through the TopBar hamburger → `MobileNavDrawer`.
 */

/**
 * Shared nav body — the brand header, tenant chip, and sectioned link list.
 * Rendered by the desktop rail and by the mobile drawer (with
 * `onNavigate` wired to close the drawer on selection). Keeping ONE renderer
 * means the two surfaces can never drift in routes or active-state logic.
 */
export function SidebarNav({
  tenantName,
  t,
  activeHref,
  onNavigate,
}: {
  readonly tenantName: string;
  readonly t: TFn;
  readonly activeHref: string | null;
  readonly onNavigate?: () => void;
}) {
  // Spread only when defined — `exactOptionalPropertyTypes` rejects passing
  // `onClick={undefined}` to next/link.
  const navHandler = onNavigate ? { onClick: onNavigate } : {};
  return (
    <>
      {/* Brand mark + tenant strapline */}
      <div className="flex h-16 items-center gap-3 border-b border-border/60 px-5">
        <Link
          href="/"
          className="flex items-center gap-3"
          {...navHandler}
        >
          <Logomark className="h-8 w-8" />
          <div className="leading-tight text-foreground">
            {/* Canonical wordmark — Fraunces display, not hand-set text.
                `currentColor` lets it follow the foreground in light/dark,
                mirroring how the marketing Nav consumes BorjieLogo. */}
            <BorjieLogo variant="wordmark" size={20} wordmarkColor="currentColor" />
            <div className="mt-0.5 text-tiny font-semibold uppercase tracking-eyebrow-wide text-neutral-500">
              {t('nav.ownerCockpit')}
            </div>
          </div>
        </Link>
      </div>

      {/* Tenant chip */}
      <div className="px-5 pt-4 pb-2">
        <div className="rounded-xl border border-border/60 bg-surface/60 px-3 py-2.5">
          <div className="text-tiny font-semibold uppercase tracking-eyebrow-wide text-neutral-500">
            {t('nav.tenant')}
          </div>
          <div className="mt-0.5 truncate text-sm font-medium text-foreground">
            {tenantName}
          </div>
        </div>
      </div>

      {/* Nav scroll area */}
      <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label={t('common.ownerNavigation')}>
        {SECTIONS.map((section) => (
          <div key={section.headingKey} className="mb-4">
            <div className="flex items-center gap-3 px-3 mt-3 mb-2">
              <span className="text-tiny font-semibold uppercase tracking-eyebrow-wide text-neutral-500">
                {t(section.headingKey)}
              </span>
              <div className="flex-1 border-t border-dashed border-border/60" />
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = item.href === activeHref;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      {...navHandler}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-xl px-2.5 py-2',
                        'text-sm font-medium text-neutral-400 transition-colors',
                        'hover:bg-surface hover:text-foreground',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        active && 'bg-signal-500/10 text-foreground',
                      )}
                      aria-current={active ? 'page' : undefined}
                    >
                      {active ? (
                        <span
                          aria-hidden
                          className="absolute left-0 top-1/2 h-5 w-rail -translate-y-1/2 rounded-full bg-signal-500"
                        />
                      ) : null}
                      <span
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                          'bg-surface/60 transition-colors',
                          active && 'bg-signal-500/15 text-signal-500',
                          !active && 'group-hover:bg-surface',
                        )}
                      >
                        <Icon className="h-chip w-chip" />
                      </span>
                      <span className="flex-1 truncate">{t(item.labelKey)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}

interface SidebarProps {
  readonly tenantName: string;
  /**
   * Server-resolved locale, threaded down from OwnerShell so `useT` SEEDS
   * the first client render to the SAME language the SSR `<html lang>`
   * chrome used. Without this seed `useT` defaults to `en` and renders a
   * one-frame EN sidebar under an SW page (the first-paint split-brain —
   * a zero-mix canon violation).
   */
  readonly languagePreference?: 'sw' | 'en';
}

export function Sidebar({ tenantName, languagePreference }: SidebarProps) {
  const pathname = usePathname();
  const t = useT(languagePreference);
  const activeHref = bestActiveHref(pathname, SECTIONS);

  return (
    <aside
      className={cn(
        // Hidden below `lg`, shown as a sticky rail from `lg` up. Below `lg`
        // the TopBar hamburger opens the same nav in a Drawer.
        'z-40 hidden h-screen w-[260px] shrink-0 flex-col lg:flex',
        'border-r border-border/60 bg-surface/40',
        'sticky top-0',
      )}
    >
      <SidebarNav tenantName={tenantName} t={t} activeHref={activeHref} />
    </aside>
  );
}
