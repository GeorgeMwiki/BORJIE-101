import { cookies } from 'next/headers';
import { Card, Skeleton } from '@borjie/design-system';
import { DegradedCard } from '@/components/DegradedCard';
import { requirePublicBaseUrl } from '@/lib/env-guard';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale, type Locale } from '@/lib/locale-shared';

const SLOTS = [
  {
    key: 'arrears-by-jurisdiction',
    title: {
      en: 'Outstanding royalties by jurisdiction',
      sw: 'Mrabaha unaodaiwa kwa mamlaka',
    },
  },
  {
    key: 'occupancy-by-class',
    title: { en: 'Production by asset grade', sw: 'Uzalishaji kwa daraja la mali' },
  },
  {
    key: 'vendor-reopen-rate',
    title: { en: 'Contractor reopen rate', sw: 'Kiwango cha kufungua upya cha mkandarasi' },
  },
  {
    key: 'sentiment-index',
    title: { en: 'Operator sentiment index', sw: 'Faharasa ya hisia za mwendeshaji' },
  },
  {
    key: 'renewal-rate',
    title: { en: 'Licence renewal rate', sw: 'Kiwango cha kuhuisha leseni' },
  },
  {
    key: 'maintenance-ttc',
    title: { en: 'Maintenance TTC', sw: 'TTC ya matengenezo' },
  },
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

async function fetchSlot(
  slot: SlotKey,
  cookieHeader: string,
  locale: Locale,
): Promise<SlotResult> {
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
        reason: pickByLocale(locale, {
          en: 'Platform aggregator offline (503). No mock values rendered.',
          sw: 'Mkusanyaji wa jukwaa hauko mtandaoni (503). Hakuna thamani bandia zilizoonyeshwa.',
        }),
      };
    }
    if (!res.ok) {
      return {
        status: 'degraded',
        reason: pickByLocale(locale, {
          en: `Upstream returned ${res.status}. Retry when the DP-aggregator is healthy.`,
          sw: `Chanzo kilirudisha ${res.status}. Jaribu tena mkusanyaji-DP ukiwa salama.`,
        }),
      };
    }
    const data = (await res.json()) as SlotPayload;
    return { status: 'ok', data };
  } catch {
    return {
      status: 'degraded',
      reason: pickByLocale(locale, {
        en: 'Aggregator unreachable. No mock values rendered.',
        sw: 'Mkusanyaji haufikiki. Hakuna thamani bandia zilizoonyeshwa.',
      }),
    };
  }
}

export default async function IndustryPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const locale = await readLocaleFromServerCookies();

  const slotResults = await Promise.all(
    SLOTS.map(async (slot) => ({
      slot,
      result: await fetchSlot(slot.key, cookieHeader, locale),
    })),
  );

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-3xl font-display text-foreground mb-1">
          {pickByLocale(locale, {
            en: 'Industry dashboard',
            sw: 'Dashibodi ya sekta',
          })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {pickByLocale(locale, {
            en: 'Six DP-aggregated platform KPIs. Each slot renders live or declares degraded.',
            sw: 'KPI sita za jukwaa zilizokusanywa-DP. Kila nafasi huonyesha moja kwa moja au hutangaza udhaifu.',
          })}
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {slotResults.map(({ slot, result }) => {
          const title = pickByLocale(locale, slot.title);
          if (result.status === 'degraded') {
            return (
              <DegradedCard
                key={slot.key}
                title={title}
                reason={result.reason}
              />
            );
          }
          if (result.status === 'loading') {
            return (
              <Card key={slot.key} className="rounded-2xl p-6 transition-colors hover:border-border-strong">
                <div className="platform-card-title">{title}</div>
                <Skeleton className="mt-2 h-7 w-24 rounded" />
              </Card>
            );
          }
          return (
            <Card key={slot.key} className="rounded-2xl p-6 transition-colors hover:border-border-strong">
              <div className="platform-card-title">{title}</div>
              <div className="platform-card-value">
                {result.data.value}
                {result.data.unit ? (
                  <span className="ml-1 text-base text-muted-foreground">
                    {result.data.unit}
                  </span>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
