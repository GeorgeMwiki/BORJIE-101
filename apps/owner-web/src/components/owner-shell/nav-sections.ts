import {
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
  Workflow,
  LineChart,
  Banknote,
  FileSearch,
  ListChecks,
  Landmark,
  Gem,
  GitBranch,
  ArrowLeftRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Owner-cockpit navigation model — the SINGLE source of truth for every
 * cockpit route, shared by the desktop `Sidebar` rail and the below-`lg`
 * `MobileNavDrawer`. Both consume this list so the responsive collapse can
 * never strand a route: every desktop entry is reachable from the drawer.
 *
 * Sections track Borjie's `OWNER_SCREENS` mental model (Overview / Field /
 * Operations / Money / Estate / Compliance / Community / Settings). Each
 * label is a dictionary key resolved at render time through the active
 * locale, so the nav paints one language only (zero-mix).
 */

export interface NavItem {
  readonly labelKey: string;
  readonly href: string;
  readonly icon: LucideIcon;
}

export interface NavSection {
  readonly headingKey: string;
  readonly items: ReadonlyArray<NavItem>;
}

export const SECTIONS: ReadonlyArray<NavSection> = [
  {
    headingKey: 'nav.sectionOverview',
    items: [
      { labelKey: 'nav.dashboard', href: '/dashboard', icon: LayoutDashboard },
      { labelKey: 'nav.cockpit', href: '/cockpit', icon: BarChart3 },
      { labelKey: 'nav.masterBrain', href: '/master-brain', icon: Brain },
      { labelKey: 'nav.lmbm', href: '/lmbm', icon: Network },
      { labelKey: 'nav.ask', href: '/ask', icon: MessageCircle },
      { labelKey: 'nav.headBriefing', href: '/head-briefing', icon: Sparkles },
      { labelKey: 'nav.agentic', href: '/agentic', icon: Brain },
      { labelKey: 'nav.training', href: '/training/scenarios', icon: GraduationCap },
      { labelKey: 'nav.livingPlan', href: '/living-plan', icon: ListChecks },
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
      { labelKey: 'nav.documentIntelligence', href: '/document-intelligence', icon: FileSearch },
      { labelKey: 'nav.people', href: '/people', icon: Users },
      { labelKey: 'nav.workforceTabs', href: '/workforce-tabs', icon: Users },
    ],
  },
  {
    headingKey: 'nav.sectionOperations',
    items: [
      { labelKey: 'nav.flows', href: '/flows', icon: Workflow },
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
      { labelKey: 'nav.market', href: '/market', icon: LineChart },
      { labelKey: 'nav.payroll', href: '/payroll', icon: Banknote },
    ],
  },
  {
    headingKey: 'nav.sectionEstate',
    items: [
      { labelKey: 'nav.estate', href: '/estate', icon: Landmark },
      { labelKey: 'nav.estateEntities', href: '/estate/entities', icon: Building2 },
      { labelKey: 'nav.estateAssets', href: '/estate/assets', icon: Gem },
      { labelKey: 'nav.estateCapitalMovements', href: '/estate/capital-movements', icon: ArrowLeftRight },
      { labelKey: 'nav.estateSuccession', href: '/estate/succession', icon: GitBranch },
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

/** Does `href` cover `pathname` (exact or as a path-segment prefix)? */
export function hrefCovers(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The single most-specific nav href for the current path. With nested routes
 * in the nav (e.g. `/estate` and `/estate/assets`), a bare prefix test would
 * light BOTH the parent and the child — so the longest covering href wins and
 * only that one renders active. For the flat, non-overlapping entries this is
 * identical to a plain prefix match.
 */
export function bestActiveHref(
  pathname: string | null,
  sections: ReadonlyArray<NavSection>,
): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      if (hrefCovers(item.href, pathname) && item.href.length > (best?.length ?? -1)) {
        best = item.href;
      }
    }
  }
  return best;
}
