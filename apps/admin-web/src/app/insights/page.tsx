import { cookies } from 'next/headers';
import { Empty } from '@borjie/design-system';
import { DegradedCard } from '@/components/DegradedCard';
import { requirePublicBaseUrl } from '@/lib/env-guard';

interface InsightPattern {
  readonly id: string;
  readonly title: string;
  readonly correlation: number;
  readonly cohort: string;
}

type InsightsResult =
  | { readonly status: 'ok'; readonly patterns: ReadonlyArray<InsightPattern> }
  | { readonly status: 'degraded'; readonly reason: string };

async function fetchPatterns(cookieHeader: string): Promise<InsightsResult> {
  try {
    const base = requirePublicBaseUrl(
      'NEXT_PUBLIC_PLATFORM_PORTAL_BASE_URL',
      'http://localhost:3020',
    );
    const res = await fetch(`${base}/api/platform/insights/patterns`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (res.status === 503) {
      return {
        status: 'degraded',
        reason: 'Pattern explorer offline (503). Cross-tenant index not available.',
      };
    }
    if (!res.ok) {
      return {
        status: 'degraded',
        reason: `Upstream returned ${res.status}. Retry when the insights service is healthy.`,
      };
    }
    const data = (await res.json()) as { patterns: ReadonlyArray<InsightPattern> };
    return { status: 'ok', patterns: data.patterns };
  } catch {
    return {
      status: 'degraded',
      reason: 'Pattern explorer unreachable. No mock correlations rendered.',
    };
  }
}

export default async function InsightsPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const result = await fetchPatterns(cookieHeader);

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-3xl font-display text-foreground mb-1">
          Cross-tenant insights
        </h1>
        <p className="text-sm text-muted-foreground">
          Pattern explorer over the DP-aggregated platform graph.
        </p>
      </header>

      {result.status === 'degraded' ? (
        <DegradedCard title="Pattern explorer" reason={result.reason} />
      ) : result.patterns.length === 0 ? (
        <Empty
          title="No significant patterns"
          description="No patterns above the significance threshold in the current window."
        />
      ) : (
        <ul className="space-y-2">
          {result.patterns.map((pattern) => (
            <li key={pattern.id} className="platform-card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {pattern.title}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Cohort: {pattern.cohort}
                  </div>
                </div>
                <div className="text-lg font-display text-signal-500">
                  ρ = {pattern.correlation.toFixed(2)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
