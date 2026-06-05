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
  GraduationCap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Logomark } from '@borjie/design-system';
import { cn } from '@borjie/design-system';
import { useT } from '@/i18n/t.client';

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
  readonly labelKey: string;
  readonly href: string;
  readonly icon: LucideIcon;
}

interface NavSection {
  readonly headingKey: string;
  readonly items: ReadonlyArray<NavItem>;
}

const SECTIONS: ReadonlyArray<NavSection> = [
  {
    headingKey: 'nav.sectionOverview',
    items: [
      { labelKey: 'nav.home', href: '/', icon: Home },
      { labelKey: 'nav.dashboard', href: '/dashboard', icon: LayoutDashboard },
      { labelKey: 'nav.cockpit', href: '/cockpit', icon: BarChart3 },
      { labelKey: 'nav.masterBrain', href: '/master-brain', icon: Brain },
      { labelKey: 'nav.lmbm', href: '/lmbm', icon: Network },
      { labelKey: 'nav.ask', href: '/ask', icon: MessageCircle },
      { labelKey: 'nav.training', href: '/training/scenarios', icon: GraduationCap },
    ],
  },
  {
    headingKey: 'nav.sectionField',
    items: [
      { labelKey: 'nav.portfolioMap', href: '/portfolio-map', icon: Map },
      { labelKey: 'nav.sites', href: '/sites', icon: Mountain },
      { labelKey: 'nav.siteCockpit', href: '/site-cockpit', icon: Layers },
      { labelKey: 'nav.licences', href: '/licences', icon: FileCheck },
      { labelKey: 'nav.documents', href: '/documents', icon: FileText },
      { labelKey: 'nav.people', href: '/people', icon: Users },
      { labelKey: 'nav.workforceTabs', href: '/workforce-tabs', icon: Users },
    ],
  },
  {
    headingKey: 'nav.sectionOperations',
    items: [
      { labelKey: 'nav.fleet', href: '/fleet', icon: Truck },
      { labelKey: 'nav.inventory', href: '/inventory', icon: Package },
      { labelKey: 'nav.geology', href: '/geology', icon: TestTubes },
      { labelKey: 'nav.counterparties', href: '/counterparties', icon: Building2 },
      { labelKey: 'nav.chainOfCustody', href: '/chain-of-custody', icon: LinkIcon },
    ],
  },
  {
    headingKey: 'nav.sectionMoney',
    items: [
      { labelKey: 'nav.finance', href: '/finance', icon: Calculator },
      { labelKey: 'nav.sales', href: '/sales', icon: TrendingUp },
      { labelKey: 'nav.treasury', href: '/treasury', icon: TrendingUp },
      { labelKey: 'nav.marketplace', href: '/marketplace', icon: Store },
    ],
  },
  {
    headingKey: 'nav.sectionCompliance',
    items: [
      { labelKey: 'nav.compliance', href: '/compliance', icon: ShieldCheck },
      { labelKey: 'nav.safety', href: '/safety', icon: HardHat },
      { labelKey: 'nav.regulatorCalendar', href: '/regulatory-calendar', icon: Scale },
    ],
  },
  {
    headingKey: 'nav.sectionCommunity',
    items: [
      { labelKey: 'nav.community', href: '/community', icon: HeartHandshake },
    ],
  },
  {
    headingKey: 'nav.sectionSettings',
    items: [
      { labelKey: 'nav.reports', href: '/reports', icon: BarChart3 },
      { labelKey: 'nav.groupView', href: '/group', icon: Layers },
      { labelKey: 'nav.onboarding', href: '/onboarding', icon: Sparkles },
      { labelKey: 'nav.settings', href: '/settings', icon: Settings },
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
  /**
   * Retained for caller compatibility; the active locale now flows from
   * the borjie_locale cookie via useT(), the single locale source.
   */
  readonly languagePreference?: 'sw' | 'en';
}

export function Sidebar({ tenantName }: SidebarProps) {
  const pathname = usePathname();
  const t = useT();

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
            <div className="text-tiny font-semibold uppercase tracking-eyebrow-wide text-neutral-500">
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
    </aside>
  );
}
