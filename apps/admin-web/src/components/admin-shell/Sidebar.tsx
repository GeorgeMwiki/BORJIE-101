'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Building2,
  ScrollText,
  Activity,
  ShieldCheck,
  Sparkles,
  Briefcase,
  Settings,
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

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: '/dashboard', icon: Home, label: 'Cockpit', labelSw: 'Dashibodi' },
  { href: '/tenants', icon: Building2, label: 'Tenants', labelSw: 'Wapangaji' },
  { href: '/audit', icon: ScrollText, label: 'Audit', labelSw: 'Ukaguzi' },
  { href: '/health', icon: Activity, label: 'Health', labelSw: 'Afya' },
  { href: '/policies', icon: ShieldCheck, label: 'Policies', labelSw: 'Sera' },
  { href: '/brain', icon: Sparkles, label: 'Brain', labelSw: 'Akili' },
  { href: '/cases', icon: Briefcase, label: 'Cases', labelSw: 'Kesi' },
  { href: '/settings', icon: Settings, label: 'Settings', labelSw: 'Mipangilio' },
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
