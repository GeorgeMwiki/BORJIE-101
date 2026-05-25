import { cookies } from 'next/headers';
import { StaffNav } from '@/components/StaffNav';
import { StaffIdentityStrip } from '@/components/StaffIdentityStrip';
import { DegradedCard } from '@/components/DegradedCard';

interface RadarSignal {
  readonly id: string;
  readonly severity: 'info' | 'warn' | 'critical';
  readonly summary: string;
  readonly detectedAt: string;
}

type RadarResult =
  | { readonly status: 'ok'; readonly signals: ReadonlyArray<RadarSignal> }
  | { readonly status: 'degraded'; readonly reason: string };

async function fetchSignals(cookieHeader: string): Promise<RadarResult> {
  try {
    const base = process.env.NEXT_PUBLIC_PLATFORM_PORTAL_BASE_URL ?? 'http://localhost:3020';
    const res = await fetch(`${base}/api/platform/radar/signals`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (res.status === 503) {
      return {
        status: 'degraded',
        reason: 'Radar pipeline offline (503). Early-warning stream unavailable.',
      };
    }
    if (!res.ok) {
      return {
        status: 'degraded',
        reason: `Upstream returned ${res.status}. Retry when the radar pipeline is healthy.`,
      };
    }
    const data = (await res.json()) as { signals: ReadonlyArray<RadarSignal> };
    return { status: 'ok', signals: data.signals };
  } catch (error) {
    console.error('Radar signals fetch failed:', error);
    return {
      status: 'degraded',
      reason: 'Radar pipeline unreachable. No mock signals rendered.',
    };
  }
}

export default async function RadarPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const result = await fetchSignals(cookieHeader);

  return (
    <div className="flex min-h-screen">
      <StaffNav />
      <main className="flex-1 p-10">
        <header className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-display text-foreground mb-1">
              Early-warning radar
            </h1>
            <p className="text-sm text-neutral-400">
              Cross-tenant anomaly stream. Statute drift, vendor decay, sentiment dips.
            </p>
          </div>
          <StaffIdentityStrip />
        </header>

        {result.status === 'degraded' ? (
          <DegradedCard title="Radar stream" reason={result.reason} />
        ) : result.signals.length === 0 ? (
          <div className="platform-card">
            <div className="text-sm text-neutral-400">
              No signals in the current window. Pipeline healthy, stream empty.
            </div>
          </div>
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
                    {signal.severity.toUpperCase()}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {signal.detectedAt}
                  </span>
                </div>
                <p className="text-sm text-foreground mt-2">{signal.summary}</p>
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}
