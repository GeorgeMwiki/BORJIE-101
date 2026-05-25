import { cookies } from 'next/headers';
import { StaffNav } from '@/components/StaffNav';
import { StaffIdentityStrip } from '@/components/StaffIdentityStrip';
import { DegradedCard } from '@/components/DegradedCard';
import { requirePublicBaseUrl } from '@/lib/env-guard';

const SLOTS = [
  { key: 'arrears-by-jurisdiction', title: 'Arrears by jurisdiction' },
  { key: 'occupancy-by-class', title: 'Occupancy by asset class' },
  { key: 'vendor-reopen-rate', title: 'Vendor reopen rate' },
  { key: 'sentiment-index', title: 'Tenant sentiment index' },
  { key: 'renewal-rate', title: 'Renewal rate' },
  { key: 'maintenance-ttc', title: 'Maintenance TTC' },
] as const;

type SlotKey = (typeof SLOTS)[number]['key'];

interface SlotPayload {
  readonly metric: string;
  readonly value: number | string;
  readonly unit?: string;
}

type SlotResult =
  | { readonly status: 'ok'; readonly data: SlotPayload }
  | { readonly status: 'loading' }
  | { readonly status: 'degraded'; readonly reason: string };

async function fetchSlot(slot: SlotKey, cookieHeader: string): Promise<SlotResult> {
  try {
    const base = requirePublicBaseUrl(
      'NEXT_PUBLIC_PLATFORM_PORTAL_BASE_URL',
      'http://localhost:3020',
    );
    const res = await fetch(`${base}/api/platform/industry/${slot}`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (res.status === 503) {
      return {
        status: 'degraded',
        reason: 'Platform aggregator offline (503). No mock values rendered.',
      };
    }
    if (!res.ok) {
      return {
        status: 'degraded',
        reason: `Upstream returned ${res.status}. Retry when the DP-aggregator is healthy.`,
      };
    }
    const data = (await res.json()) as SlotPayload;
    return { status: 'ok', data };
  } catch (error) {
    console.error(`Industry slot ${slot} fetch failed:`, error);
    return {
      status: 'degraded',
      reason: 'Aggregator unreachable. No mock values rendered.',
    };
  }
}

export default async function IndustryPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const slotResults = await Promise.all(
    SLOTS.map(async (slot) => ({
      slot,
      result: await fetchSlot(slot.key, cookieHeader),
    })),
  );

  return (
    <div className="flex min-h-screen">
      <StaffNav />
      <main className="flex-1 p-10">
        <header className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-display text-foreground mb-1">
              Industry dashboard
            </h1>
            <p className="text-sm text-neutral-400">
              Six DP-aggregated platform KPIs. Each slot renders live or declares degraded.
            </p>
          </div>
          <StaffIdentityStrip />
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {slotResults.map(({ slot, result }) => {
            if (result.status === 'degraded') {
              return (
                <DegradedCard
                  key={slot.key}
                  title={slot.title}
                  reason={result.reason}
                />
              );
            }
            if (result.status === 'loading') {
              return (
                <div key={slot.key} className="platform-card">
                  <div className="platform-card-title">{slot.title}</div>
                  <div className="text-sm text-neutral-500">Loading…</div>
                </div>
              );
            }
            return (
              <div key={slot.key} className="platform-card">
                <div className="platform-card-title">{slot.title}</div>
                <div className="platform-card-value">
                  {result.data.value}
                  {result.data.unit ? (
                    <span className="text-base text-neutral-500 ml-1">
                      {result.data.unit}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
