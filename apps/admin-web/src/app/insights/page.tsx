import { cookies } from 'next/headers';
import { Empty } from '@borjie/design-system';
import { DegradedCard } from '@/components/DegradedCard';
import { requirePublicBaseUrl } from '@/lib/env-guard';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale, type Locale } from '@/lib/locale-shared';

interface InsightPattern {
  readonly id: string;
  readonly title: string;
  readonly correlation: number;
  readonly cohort: string;
}

/**
 * Degraded reasons are returned as a locale-NEUTRAL key + interpolation
 * payload so the rendering surface resolves the copy in the active locale
 * (zero-mix canon — the reason text never settles in English under a
 * Swahili shell). The optional `status` carries the upstream HTTP code for
 * the generic-upstream variant.
 */
type DegradedReason =
  | { readonly key: 'offline' }
  | { readonly key: 'upstream'; readonly status: number }
  | { readonly key: 'unreachable' };

type InsightsResult =
  | { readonly status: 'ok'; readonly patterns: ReadonlyArray<InsightPattern> }
  | { readonly status: 'degraded'; readonly reason: DegradedReason };

// Header + state copy resolved on the SERVER from the same cookie that seeds
// the client locale, so SSR and the first client paint render the SAME
// language (zero-mix canon — never an English header over a Swahili shell).
const COPY = {
  title: { en: 'Cross-tenant insights', sw: 'Maarifa ya mashirika yote' },
  subtitle: {
    en: 'Pattern explorer over the DP-aggregated platform graph.',
    sw: 'Kichunguzi cha ruwaza juu ya grafu ya jukwaa iliyokusanywa kwa DP.',
  },
  degradedTitle: { en: 'Pattern explorer', sw: 'Kichunguzi cha ruwaza' },
  emptyTitle: { en: 'No significant patterns', sw: 'Hakuna ruwaza muhimu' },
  emptyBody: {
    en: 'No patterns above the significance threshold in the current window.',
    sw: 'Hakuna ruwaza zilizo juu ya kizingiti cha umuhimu katika kipindi cha sasa.',
  },
  cohort: { en: 'Cohort', sw: 'Kundi' },
} as const;

const REASON_COPY = {
  offline: {
    en: 'Pattern explorer offline (503). Cross-tenant index not available.',
    sw: 'Kichunguzi cha ruwaza hakipatikani (503). Faharasa ya mashirika yote haipatikani.',
  },
  unreachable: {
    en: 'Pattern explorer unreachable. No mock correlations rendered.',
    sw: 'Kichunguzi cha ruwaza hakifikiki. Hakuna uhusiano bandia ulioonyeshwa.',
  },
  upstream: {
    en: (status: number) =>
      `Upstream returned ${status}. Retry when the insights service is healthy.`,
    sw: (status: number) =>
      `Huduma ya juu ilirudisha ${status}. Jaribu tena pindi huduma ya maarifa itakapokuwa nzima.`,
  },
} as const;

function renderReason(locale: Locale, reason: DegradedReason): string {
  if (reason.key === 'upstream') {
    return pickByLocale(locale, REASON_COPY.upstream)(reason.status);
  }
  return pickByLocale(locale, REASON_COPY[reason.key]);
}

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
      return { status: 'degraded', reason: { key: 'offline' } };
    }
    if (!res.ok) {
      return {
        status: 'degraded',
        reason: { key: 'upstream', status: res.status },
      };
    }
    const data = (await res.json()) as { patterns: ReadonlyArray<InsightPattern> };
    return { status: 'ok', patterns: data.patterns };
  } catch {
    return { status: 'degraded', reason: { key: 'unreachable' } };
  }
}

export default async function InsightsPage() {
  const locale = await readLocaleFromServerCookies();
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
          {pickByLocale(locale, COPY.title)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {pickByLocale(locale, COPY.subtitle)}
        </p>
      </header>

      {result.status === 'degraded' ? (
        <DegradedCard
          title={pickByLocale(locale, COPY.degradedTitle)}
          reason={renderReason(locale, result.reason)}
        />
      ) : result.patterns.length === 0 ? (
        <Empty
          title={pickByLocale(locale, COPY.emptyTitle)}
          description={pickByLocale(locale, COPY.emptyBody)}
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
                    {pickByLocale(locale, COPY.cohort)}: {pattern.cohort}
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
