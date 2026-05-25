import Link from 'next/link';
import { cookies } from 'next/headers';
import { ArrowRight } from 'lucide-react';
import { StaffNav } from '@/components/StaffNav';
import { StaffIdentityStrip } from '@/components/StaffIdentityStrip';
import { DegradedCard } from '@/components/DegradedCard';
import { PrefetchNavLink } from '@/components/PrefetchNavLink';
import { PLATFORM_SESSION_COOKIE } from '@/lib/session';
import { requirePublicBaseUrl } from '@/lib/env-guard';
import { SCREEN_GROUPS, INTERNAL_SCREENS } from '@/lib/internal/screens';

const HERO_CARDS = [
  {
    href: '/industry',
    title: 'Industry dashboard',
    description:
      'Sector-wide KPIs aggregated across every tenant under differential-privacy guarantees.',
  },
  {
    href: '/radar',
    title: 'Early-warning radar',
    description:
      'Cross-tenant anomaly stream — statute drift, vendor decay, sentiment dips before they compound.',
  },
  {
    href: '/insights',
    title: 'Cross-tenant insights',
    description:
      'Pattern explorer over the platform graph. Correlations, cohorts, regime shifts.',
  },
  {
    href: '/forecasts',
    title: 'Platform forecasts',
    description:
      'TGN-powered sector forecasts with conformal intervals. Quarterly-horizon, calibrated.',
  },
] as const;

interface BudgetPayload {
  readonly remainingEpsilon?: number;
  readonly totalEpsilon?: number;
  readonly windowLabel?: string;
}

async function fetchBudget(cookieHeader: string): Promise<BudgetPayload | null> {
  try {
    const base = requirePublicBaseUrl(
      'NEXT_PUBLIC_PLATFORM_PORTAL_BASE_URL',
      'http://localhost:3020',
    );
    const res = await fetch(`${base}/api/platform/budget`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as BudgetPayload;
  } catch (error) {
    console.error('Home budget fetch failed:', error);
    return null;
  }
}

export default async function HomePage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const sessionPresent = Boolean(cookieStore.get(PLATFORM_SESSION_COOKIE)?.value);
  const budget = sessionPresent ? await fetchBudget(cookieHeader) : null;

  return (
    <div className="flex min-h-screen">
      <StaffNav />
      <main className="flex-1 p-10">
        <header className="flex items-start justify-between mb-10">
          <div>
            <h1 className="text-4xl font-display text-foreground mb-2">
              Platform HQ
            </h1>
            <p className="text-sm text-neutral-400 max-w-xl">
              Industry-wide signals across every Borjie tenant. All views
              render from DP-aggregated platform graph — never raw tenant data.
            </p>
          </div>
          <StaffIdentityStrip />
        </header>

        <section className="mb-8">
          <Link
            href="/internal"
            className="platform-card block hover:border-signal-500/40 transition-colors group border-signal-500/30"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-[0.62rem] uppercase tracking-widest text-signal-500 mb-1">
                  Internal admin · Section D
                </p>
                <h2 className="text-2xl font-display text-foreground">
                  Borjie Console
                </h2>
              </div>
              <ArrowRight className="w-5 h-5 text-neutral-500 group-hover:text-signal-500 transition-colors" />
            </div>
            <p className="text-sm text-neutral-400 mb-3">
              {INTERNAL_SCREENS.length} operational surfaces across{' '}
              {SCREEN_GROUPS.map((g) => g.label).join(' · ')}. Tenant directory,
              corpus, prompt registry, compliance queue, killswitch.
            </p>
            <div className="flex flex-wrap gap-2">
              {SCREEN_GROUPS.map((group) => (
                <span
                  key={group.id}
                  className="text-[0.62rem] uppercase tracking-widest text-neutral-400 border border-border rounded-full px-2 py-0.5"
                >
                  {group.label}
                </span>
              ))}
            </div>
          </Link>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
          {HERO_CARDS.map((card) => (
            <PrefetchNavLink
              key={card.href}
              href={card.href}
              className="platform-card hover:border-signal-500/40 transition-colors group"
            >
              <div className="flex items-start justify-between mb-3">
                <h2 className="text-lg font-display text-foreground">
                  {card.title}
                </h2>
                <ArrowRight className="w-4 h-4 text-neutral-500 group-hover:text-signal-500 transition-colors" />
              </div>
              <p className="text-sm text-neutral-400">{card.description}</p>
            </PrefetchNavLink>
          ))}
        </section>

        <section>
          <h3 className="text-xs uppercase tracking-wider text-neutral-500 mb-3">
            Privacy budget
          </h3>
          {budget && typeof budget.remainingEpsilon === 'number' ? (
            <div className="platform-card flex items-baseline gap-4">
              <span className="text-4xl font-display text-signal-500">
                {budget.remainingEpsilon.toFixed(2)} ε
              </span>
              <span className="text-sm text-neutral-400">
                remaining
                {typeof budget.totalEpsilon === 'number'
                  ? ` of ${budget.totalEpsilon.toFixed(2)} ε`
                  : ''}
                {budget.windowLabel ? ` · ${budget.windowLabel}` : ''}
              </span>
            </div>
          ) : (
            <DegradedCard
              title="Privacy budget"
              reason="Platform DP-accountant is offline. No mock numbers rendered — re-check when the graph-privacy service reports healthy."
            />
          )}
        </section>
      </main>
    </div>
  );
}
