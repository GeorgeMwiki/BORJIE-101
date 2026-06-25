import { cookies } from 'next/headers';
import { Empty } from '@borjie/design-system';
import { DegradedCard } from '@/components/DegradedCard';
import { requirePublicBaseUrl } from '@/lib/env-guard';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale, type Locale } from '@/lib/locale-shared';

interface RadarSignal {
  readonly id: string;
  readonly severity: 'info' | 'warn' | 'critical';
  readonly summary: string;
  readonly detectedAt: string;
}

/**
 * Degraded reasons are returned as a locale-NEUTRAL key + interpolation
 * payload so the rendering surface resolves the copy in the active locale
 * (zero-mix canon — the reason text never settles in English under a
 * Swahili shell).
 */
type DegradedReason =
  | { readonly key: 'offline' }
  | { readonly key: 'upstream'; readonly status: number }
  | { readonly key: 'unreachable' };

type RadarResult =
  | { readonly status: 'ok'; readonly signals: ReadonlyArray<RadarSignal> }
  | { readonly status: 'degraded'; readonly reason: DegradedReason };

// Header + state copy resolved on the SERVER from the same cookie that seeds
// the client locale, so SSR and the first client paint render the SAME
// language (zero-mix canon — never an English header over a Swahili shell).
const COPY = {
  title: { en: 'Early-warning radar', sw: 'Rada ya tahadhari ya mapema' },
  subtitle: {
    en: 'Cross-tenant anomaly stream. Statute drift, vendor decay, sentiment dips.',
    sw: 'Mtiririko wa hitilafu za mashirika yote. Mabadiliko ya sheria, kudorora kwa wasambazaji, kushuka kwa hisia.',
  },
  degradedTitle: { en: 'Radar stream', sw: 'Mtiririko wa rada' },
  emptyTitle: { en: 'No signals in window', sw: 'Hakuna ishara katika kipindi' },
  emptyBody: {
    en: 'The radar pipeline is healthy and the stream is empty — anomalies will appear here.',
    sw: 'Bomba la rada ni zima na mtiririko ni mtupu — hitilafu zitaonekana hapa.',
  },
} as const;

// Raw severity enum tokens map through a localized label table — never a
// bare `.toUpperCase()` leaking an English-only token under a Swahili shell.
const SEVERITY_LABEL = {
  info: { en: 'INFO', sw: 'TAARIFA' },
  warn: { en: 'WARNING', sw: 'ONYO' },
  critical: { en: 'CRITICAL', sw: 'HATARI' },
} as const;

const REASON_COPY = {
  offline: {
    en: 'Radar pipeline offline (503). Early-warning stream unavailable.',
    sw: 'Bomba la rada halipatikani (503). Mtiririko wa tahadhari ya mapema haupatikani.',
  },
  unreachable: {
    en: 'Radar pipeline unreachable. No mock signals rendered.',
    sw: 'Bomba la rada halifikiki. Hakuna ishara bandia zilizoonyeshwa.',
  },
  upstream: {
    en: (status: number) =>
      `Upstream returned ${status}. Retry when the radar pipeline is healthy.`,
    sw: (status: number) =>
      `Huduma ya juu ilirudisha ${status}. Jaribu tena pindi bomba la rada litakapokuwa zima.`,
  },
} as const;

function renderReason(locale: Locale, reason: DegradedReason): string {
  if (reason.key === 'upstream') {
    return pickByLocale(locale, REASON_COPY.upstream)(reason.status);
  }
  return pickByLocale(locale, REASON_COPY[reason.key]);
}

async function fetchSignals(cookieHeader: string): Promise<RadarResult> {
  try {
    const base = requirePublicBaseUrl(
      'NEXT_PUBLIC_PLATFORM_PORTAL_BASE_URL',
      'http://localhost:3020',
    );
    const res = await fetch(`${base}/api/platform/radar/signals`, {
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
    const data = (await res.json()) as { signals: ReadonlyArray<RadarSignal> };
    return { status: 'ok', signals: data.signals };
  } catch {
    return { status: 'degraded', reason: { key: 'unreachable' } };
  }
}

export default async function RadarPage() {
  const locale = await readLocaleFromServerCookies();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const result = await fetchSignals(cookieHeader);

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
      ) : result.signals.length === 0 ? (
        <Empty
          title={pickByLocale(locale, COPY.emptyTitle)}
          description={pickByLocale(locale, COPY.emptyBody)}
        />
      ) : (
        <ol className="space-y-2">
          {result.signals.map((signal) => (
            <li key={signal.id} className="platform-card">
              <div className="flex items-start justify-between gap-4">
                <span
                  className={
                    signal.severity === 'critical'
                      ? 'text-sm font-medium text-danger'
                      : signal.severity === 'warn'
                        ? 'text-sm font-medium text-warning'
                        : 'text-sm font-medium text-info'
                  }
                >
                  {pickByLocale(locale, SEVERITY_LABEL[signal.severity])}
                </span>
                <span className="text-xs text-muted-foreground">
                  {signal.detectedAt}
                </span>
              </div>
              <p className="mt-2 text-sm text-foreground">{signal.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
