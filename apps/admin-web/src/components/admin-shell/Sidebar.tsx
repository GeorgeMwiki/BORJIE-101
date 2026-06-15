'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Building2,
  ScrollText,
  Activity,
  Sparkles,
  Briefcase,
  LayoutGrid,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { Logomark } from '@borjie/design-system';

/**
 * Sidebar — dense left rail for the Borjie admin console.
 *
 * Mirrors the LitFin admin/officer sidebar shape (logo at top, grouped
 * nav, active-route highlight) while staying bilingual (sw/en) and
 * using Borjie navy/gold tokens. Items map to the eight admin-web
 * primary surfaces called out in the parity brief; deeper screens
 * still live under /internal/* and are reachable from the cockpit.
 */

interface NavItem {
  readonly href: string;
  readonly icon: LucideIcon;
  readonly label: string;
  /** Swahili label — shown when locale flag is set. */
  readonly labelSw: string;
}

// Every href below resolves to a real page in `app/` — no 404s. The
// earlier rail pointed at five aspirational slugs (/health, /policies,
// /brain, /cases, /settings) that were never built; they are repointed
// to the screens that actually ship. `/policies` had no real
// destination and was dropped rather than left dead.
const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: '/dashboard', icon: Home, label: 'Cockpit', labelSw: 'Dashibodi' },
  { href: '/tenants', icon: Building2, label: 'Tenants', labelSw: 'Wapangaji' },
  { href: '/audit', icon: ScrollText, label: 'Audit', labelSw: 'Ukaguzi' },
  { href: '/system-health', icon: Activity, label: 'Health', labelSw: 'Afya' },
  { href: '/jarvis', icon: Sparkles, label: 'Brain', labelSw: 'Akili' },
  { href: '/control-tower', icon: Briefcase, label: 'Control tower', labelSw: 'Mnara wa Udhibiti' },
  { href: '/internal', icon: LayoutGrid, label: 'Console', labelSw: 'Konsoli' },
  // Forecasts hero view. The Industry / Radar / Insights links were
  // removed: their platform aggregators (/api/v1/platform/{industry,
  // radar,insights}/*) are not yet mounted in the gateway, so the pages
  // render permanent empty shells. Re-add each link when its aggregator
  // is wired, rather than advertise a born-dark surface in the nav.
  { href: '/forecasts', icon: TrendingUp, label: 'Forecasts', labelSw: 'Utabiri' },
];

export interface SidebarProps {
  /** Show Swahili labels next to English. Default false. */
  readonly bilingual?: boolean;
}

export function Sidebar({ bilingual = false }: SidebarProps = {}): JSX.Element {
  const pathname = usePathname() ?? '';

  return (
    <aside
      aria-label="Admin primary navigation"
      className="hidden lg:flex w-60 shrink-0 flex-col border-r border-border bg-surface-sunken"
    >
      <Link
        href="/dashboard"
        className="flex items-center gap-3 border-b border-border px-5 py-5 transition-colors hover:bg-surface"
      >
        <Logomark size={28} variant="premium" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-display text-foreground">Borjie</span>
          <span className="text-tiny font-mono uppercase tracking-widest text-signal-500">
            Console
          </span>
        </div>
      </Link>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-signal-500/10 text-signal-500 ring-1 ring-signal-500/20'
                  : 'text-foreground hover:bg-surface hover:text-signal-500'
              }`}
            >
              <Icon
                className={`h-4 w-4 shrink-0 ${
                  active ? 'text-signal-500' : 'text-neutral-400 group-hover:text-signal-500'
                }`}
                aria-hidden="true"
              />
              <span className="flex flex-col leading-tight">
                <span className="font-medium">{item.label}</span>
                {bilingual ? (
                  <span className="text-tiny uppercase tracking-widest text-neutral-500">
                    {item.labelSw}
                  </span>
                ) : null}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-5 py-4 text-tiny font-mono uppercase tracking-widest text-neutral-500">
        SSO · IP allow-list
      </div>
    </aside>
  );
}
