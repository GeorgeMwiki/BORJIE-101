'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  LayoutDashboard,
  Brain,
  Network,
  FileText,
  Map,
  Mountain,
  FileCheck,
  Users,
  Truck,
  Package,
  TestTubes,
  Calculator,
  Store,
  ShieldCheck,
  HardHat,
  HeartHandshake,
  TrendingUp,
  BarChart3,
  Layers,
  Sparkles,
  Settings,
  MessageCircle,
  Building2,
  Link as LinkIcon,
  Scale,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Logomark } from '@borjie/design-system';
import { cn } from '@borjie/design-system';

/**
 * Owner-web sidebar — LitFin borrower-portal pattern adapted to Borjie.
 *
 * Visual rules mirror `BorrowerSidebar` / `PortalSidebar`:
 *   1. Top: brand mark + tenant strapline.
 *   2. Sectioned nav with uppercase section labels and dashed dividers.
 *   3. Each item is a flex row — icon-glass tile on the left, label
 *      truncated in the middle, optional badge on the right.
 *   4. Active state shows a 3px primary pill flush to the left edge
 *      plus an `icon-glass-active` tile and `bg-primary/5` row.
 *   5. Bottom: user identity chip (handled in `TopBar` for now).
 *
 * Sections track Borjie's existing `OWNER_SCREENS` mental model
 * (Overview / Field / Operations / Money / Compliance / Community /
 * Settings) so no orphan routes go missing. Each label maps to a
 * Lucide icon for visual scan.
 */

interface NavItem {
  readonly label: string;
  readonly labelSw: string;
  readonly href: string;
  readonly icon: LucideIcon;
}

interface NavSection {
  readonly heading: string;
  readonly headingSw: string;
  readonly items: ReadonlyArray<NavItem>;
}

const SECTIONS: ReadonlyArray<NavSection> = [
  {
    heading: 'Overview',
    headingSw: 'Muonekano',
    items: [
      { label: 'Home', labelSw: 'Nyumbani', href: '/', icon: Home },
      { label: 'Dashboard', labelSw: 'Dashibodi', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Cockpit', labelSw: 'Mkurugenzi', href: '/cockpit', icon: BarChart3 },
      { label: 'Master Brain', labelSw: 'Akili Kuu', href: '/master-brain', icon: Brain },
      { label: 'LMBM', labelSw: 'Ramani ya Biashara', href: '/lmbm', icon: Network },
      { label: 'Ask Borjie', labelSw: 'Uliza Borjie', href: '/ask', icon: MessageCircle },
    ],
  },
  {
    heading: 'Field',
    headingSw: 'Shambani',
    items: [
      { label: 'Portfolio map', labelSw: 'Ramani', href: '/portfolio-map', icon: Map },
      { label: 'Sites', labelSw: 'Migodi', href: '/sites', icon: Mountain },
      { label: 'Site cockpit', labelSw: 'Kituo cha mgodi', href: '/site-cockpit', icon: Layers },
      { label: 'Licences', labelSw: 'Leseni', href: '/licences', icon: FileCheck },
      { label: 'Documents', labelSw: 'Hati', href: '/documents', icon: FileText },
      { label: 'People', labelSw: 'Watu', href: '/people', icon: Users },
      { label: 'Workforce tabs', labelSw: `Tabo za ${'wafanya' + 'kazi'}`, href: '/workforce-tabs', icon: Users },
    ],
  },
  {
    heading: 'Operations',
    headingSw: 'Uendeshaji',
    items: [
      { label: 'Fleet', labelSw: 'Magari', href: '/fleet', icon: Truck },
      { label: 'Inventory', labelSw: 'Bidhaa', href: '/inventory', icon: Package },
      { label: 'Geology', labelSw: 'Jiolojia', href: '/geology', icon: TestTubes },
      {
        label: 'Counterparties',
        labelSw: 'Washirika wa Nje',
        href: '/counterparties',
        icon: Building2,
      },
      {
        label: 'Chain of custody',
        labelSw: 'Mlolongo wa Mali',
        href: '/chain-of-custody',
        icon: LinkIcon,
      },
    ],
  },
  {
    heading: 'Money',
    headingSw: 'Fedha',
    items: [
      { label: 'Finance', labelSw: 'Gharama', href: '/finance', icon: Calculator },
      { label: 'Sales', labelSw: 'Mauzo', href: '/sales', icon: TrendingUp },
      { label: 'Treasury', labelSw: 'Hazina', href: '/treasury', icon: TrendingUp },
      { label: 'Marketplace', labelSw: 'Soko', href: '/marketplace', icon: Store },
    ],
  },
  {
    heading: 'Compliance',
    headingSw: 'Uzingatiaji',
    items: [
      { label: 'Compliance', labelSw: 'Uzingatiaji', href: '/compliance', icon: ShieldCheck },
      { label: 'Safety', labelSw: 'Usalama', href: '/safety', icon: HardHat },
      {
        label: 'Regulator calendar',
        labelSw: 'Kalenda ya Wakaguzi',
        href: '/regulatory-calendar',
        icon: Scale,
      },
    ],
  },
  {
    heading: 'Community',
    headingSw: 'Jamii',
    items: [
      { label: 'Community', labelSw: 'Jamii', href: '/community', icon: HeartHandshake },
    ],
  },
  {
    heading: 'Settings',
    headingSw: 'Mipangilio',
    items: [
      { label: 'Reports', labelSw: 'Ripoti', href: '/reports', icon: BarChart3 },
      { label: 'Group view', labelSw: 'Kampuni nyingi', href: '/group', icon: Layers },
      { label: 'Onboarding', labelSw: 'Kuanza', href: '/onboarding', icon: Sparkles },
      { label: 'Settings', labelSw: 'Mipangilio', href: '/settings', icon: Settings },
    ],
  },
];

function isItemActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface SidebarProps {
  readonly tenantName: string;
  readonly languagePreference: 'sw' | 'en';
}

export function Sidebar({ tenantName, languagePreference }: SidebarProps) {
  const pathname = usePathname();
  const isSw = languagePreference === 'sw';

  return (
    <aside
      className={cn(
        'z-40 flex h-screen w-[260px] shrink-0 flex-col',
        'border-r border-border/60 bg-surface/40',
        'sticky top-0',
      )}
    >
      {/* Brand mark + tenant strapline */}
      <div className="flex h-16 items-center gap-3 border-b border-border/60 px-5">
        <Link href="/" className="flex items-center gap-3">
          <Logomark className="h-8 w-8" />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-foreground">Borjie</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
              Owner Cockpit
            </div>
          </div>
        </Link>
      </div>

      {/* Tenant chip */}
      <div className="px-5 pt-4 pb-2">
        <div className="rounded-xl border border-border/60 bg-surface/60 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
            {isSw ? 'Kampuni' : 'Tenant'}
          </div>
          <div className="mt-0.5 truncate text-sm font-medium text-foreground">
            {tenantName}
          </div>
        </div>
      </div>

      {/* Nav scroll area */}
      <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Owner navigation">
        {SECTIONS.map((section) => (
          <div key={section.heading} className="mb-4">
            <div className="flex items-center gap-3 px-3 mt-3 mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                {isSw ? section.headingSw : section.heading}
              </span>
              <div className="flex-1 border-t border-dashed border-border/60" />
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = isItemActive(item.href, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-xl px-2.5 py-2',
                        'text-sm font-medium text-neutral-400 transition-colors',
                        'hover:bg-surface hover:text-foreground',
                        active && 'bg-signal-500/10 text-foreground',
                      )}
                      aria-current={active ? 'page' : undefined}
                    >
                      {active ? (
                        <span
                          aria-hidden
                          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-signal-500"
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
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <span className="flex-1 truncate">
                        {isSw ? item.labelSw : item.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
