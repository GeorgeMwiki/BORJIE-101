import Link from 'next/link';
import { cookies } from 'next/headers';
import { Logomark } from '@borjie/design-system';
import { PLATFORM_SESSION_COOKIE } from '@/lib/session';
import { PrefetchNavLink } from './PrefetchNavLink';

interface NavGroup {
  readonly heading: string;
  readonly items: ReadonlyArray<{ readonly href: string; readonly label: string }>;
}

/**
 * Navigation is grouped so HQ operators can find all sibling surfaces
 * once they've migrated past the four hero industry views. Every page
 * that ships in this app has a nav entry — no orphan pages, no dead
 * links. New pages must be added here when their `page.tsx` lands.
 */
const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    heading: 'Console (Internal admin)',
    items: [
      { href: '/internal', label: 'Console home' },
      { href: '/internal/tenants', label: 'Tenants' },
      { href: '/internal/corpus', label: 'Corpus' },
      { href: '/internal/prompts', label: 'Prompts' },
      { href: '/internal/compliance-queue', label: 'Compliance queue' },
      { href: '/internal/killswitch', label: 'Killswitch' },
    ],
  },
  {
    heading: 'Industry',
    items: [
      { href: '/industry', label: 'Industry dashboard' },
      { href: '/radar', label: 'Early-warning radar' },
      { href: '/insights', label: 'Cross-tenant insights' },
      { href: '/forecasts', label: 'Platform forecasts' },
    ],
  },
  {
    heading: 'Conversation',
    items: [
      { href: '/jarvis', label: 'Nyumba Mind' },
      { href: '/ask', label: 'Talk to the industry' },
    ],
  },
  {
    heading: 'Platform',
    items: [
      { href: '/platform/overview', label: 'Platform overview' },
      { href: '/platform/subscriptions', label: 'Subscriptions' },
      { href: '/platform/billing', label: 'Billing' },
      { href: '/platform/feature-flags', label: 'Global flags' },
    ],
  },
  {
    heading: 'Operations',
    items: [
      { href: '/system-health', label: 'System health' },
      { href: '/control-tower', label: 'Control tower' },
      { href: '/webhook-dlq', label: 'Webhook DLQ' },
      { href: '/ai-costs', label: 'AI spend' },
      { href: '/feature-flags', label: 'Caller flags' },
      { href: '/mission-eval', label: 'Mission eval' },
      // Central Command Phase B B5 — Session replay (rrweb cold store).
      // Default lands on the recent-sessions index; an operator picks a
      // session to drill into `/session-replay/<sessionId>`.
      { href: '/session-replay', label: 'Session replay' },
    ],
  },
  {
    heading: 'Data & compliance',
    items: [
      { href: '/data-privacy', label: 'Data privacy' },
      { href: '/integrations', label: 'API integrations' },
      { href: '/legacy-migration', label: 'Legacy LPMS migration' },
      { href: '/warehouse', label: 'Warehouse' },
    ],
  },
];

interface BudgetPayload {
  readonly remainingEpsilon?: number;
  readonly totalEpsilon?: number;
}

async function fetchBudget(cookieHeader: string): Promise<BudgetPayload | null> {
  try {
    const base = process.env.NEXT_PUBLIC_PLATFORM_PORTAL_BASE_URL ?? 'http://localhost:3020';
    const res = await fetch(`${base}/api/platform/budget`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as BudgetPayload;
    return data;
  } catch (error) {
    console.error('StaffNav budget fetch failed:', error);
    return null;
  }
}

export async function StaffNav() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const sessionPresent = Boolean(cookieStore.get(PLATFORM_SESSION_COOKIE)?.value);
  const budget = sessionPresent ? await fetchBudget(cookieHeader) : null;

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-surface-sunken min-h-screen flex flex-col" aria-label="HQ navigation">
      <div className="p-6 border-b border-border flex items-center gap-3">
        <Logomark size={32} variant="premium" />
        <div className="flex flex-col">
          <span className="text-sm font-display text-foreground">Borjie</span>
          <span className="text-xs text-neutral-500 uppercase tracking-wider">HQ</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-4 space-y-5" aria-label="Primary">
        {NAV_GROUPS.map((group) => (
          <div key={group.heading} className="space-y-1" role="group" aria-labelledby={`nav-group-${group.heading.replace(/\s+/g, '-').toLowerCase()}`}>
            <div
              id={`nav-group-${group.heading.replace(/\s+/g, '-').toLowerCase()}`}
              className="px-3 text-[0.62rem] uppercase tracking-widest text-neutral-500 mb-1"
            >
              {group.heading}
            </div>
            {group.items.map((item) => (
              <PrefetchNavLink
                key={item.href}
                href={item.href}
                className="block rounded-md px-3 py-2 text-sm text-foreground hover:bg-surface transition-colors"
              >
                {item.label}
              </PrefetchNavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">
          Privacy budget
        </div>
        {budget && typeof budget.remainingEpsilon === 'number' ? (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-display text-signal-500">
              {budget.remainingEpsilon.toFixed(2)}
            </span>
            {typeof budget.totalEpsilon === 'number' && (
              <span className="text-xs text-neutral-500">
                of {budget.totalEpsilon.toFixed(2)} ε
              </span>
            )}
          </div>
        ) : (
          <div className="text-xs text-warning">
            Budget service offline
          </div>
        )}
      </div>
    </aside>
  );
}
