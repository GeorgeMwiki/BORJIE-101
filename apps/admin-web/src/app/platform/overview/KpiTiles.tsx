'use client';

import { useEffect, useState } from 'react';
import {
  Building2,
  Users,
  CreditCard,
  TrendingUp,
  Activity,
} from 'lucide-react';

/**
 * Live KPI tiles for the Platform overview page.
 *
 * Fetches `/api/platform/overview` (a Next.js BFF route the
 * admin-web will proxy to the platform-overview aggregator
 * once it ships). Until that route exists the request 404s and tiles
 * stay as em-dashes — the surface stays honest about missing data.
 *
 * Expected response shape:
 *   {
 *     success: true,
 *     data: {
 *       activeTenants: number,
 *       platformUsers: number,
 *       monthlyRevenue: number,    // major currency units (USD)
 *       unitsManaged: number,
 *       currency?: string,         // optional ISO-4217 code
 *     }
 *   }
 */

interface OverviewKpis {
  readonly activeTenants: number | null;
  readonly platformUsers: number | null;
  readonly monthlyRevenue: number | null;
  readonly unitsManaged: number | null;
  readonly currency: string;
}

const EMPTY_KPIS: OverviewKpis = {
  activeTenants: null,
  platformUsers: null,
  monthlyRevenue: null,
  unitsManaged: null,
  currency: 'USD',
};

interface OverviewResponse {
  success?: boolean;
  data?: {
    activeTenants?: number;
    platformUsers?: number;
    monthlyRevenue?: number;
    unitsManaged?: number;
    currency?: string;
  };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function parseKpis(payload: OverviewResponse): OverviewKpis {
  const data = payload.data ?? {};
  return {
    activeTenants: isFiniteNumber(data.activeTenants) ? data.activeTenants : null,
    platformUsers: isFiniteNumber(data.platformUsers) ? data.platformUsers : null,
    monthlyRevenue: isFiniteNumber(data.monthlyRevenue)
      ? data.monthlyRevenue
      : null,
    unitsManaged: isFiniteNumber(data.unitsManaged) ? data.unitsManaged : null,
    currency: typeof data.currency === 'string' ? data.currency : 'USD',
  };
}

function formatNumber(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en').format(value);
}

function formatRevenue(value: number | null, currency: string): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function KpiTiles() {
  const [kpis, setKpis] = useState<OverviewKpis>(EMPTY_KPIS);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch('/api/platform/overview', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!res.ok) {
          // 404/503/etc — aggregator not wired yet, leave em-dashes.
          return;
        }
        const body = (await res.json()) as OverviewResponse;
        if (cancelled) return;
        if (body.success === false) return;
        setKpis(parseKpis(body));
        setLive(true);
      } catch (error) {
        if (controller.signal.aborted) return;
        // Network error — surface stays em-dashed; do not log noise.
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        icon={Building2}
        label="Active tenants"
        value={formatNumber(kpis.activeTenants)}
        live={live && kpis.activeTenants !== null}
      />
      <KpiCard
        icon={Users}
        label="Platform users"
        value={formatNumber(kpis.platformUsers)}
        live={live && kpis.platformUsers !== null}
      />
      <KpiCard
        icon={CreditCard}
        label="Monthly revenue"
        value={formatRevenue(kpis.monthlyRevenue, kpis.currency)}
        live={live && kpis.monthlyRevenue !== null}
      />
      <KpiCard
        icon={Activity}
        label="Units managed"
        value={formatNumber(kpis.unitsManaged)}
        live={live && kpis.unitsManaged !== null}
      />
    </section>
  );
}

interface KpiCardProps {
  readonly icon: typeof Building2;
  readonly label: string;
  readonly value: string;
  readonly live: boolean;
}

function KpiCard({ icon: Icon, label, value, live }: KpiCardProps) {
  const isPlaceholder = value === '—';
  return (
    <div className="platform-card">
      <div className="flex items-center justify-between">
        <div className="rounded-lg bg-signal-500/10 p-2">
          <Icon className="h-5 w-5 text-signal-500" />
        </div>
        {live ? (
          <span className="flex items-center gap-1 text-sm text-emerald-400">
            <TrendingUp className="h-4 w-4" />
            Live
          </span>
        ) : null}
      </div>
      <div className="mt-4">
        <p
          className={`text-2xl font-display ${
            isPlaceholder ? 'text-neutral-500' : 'text-foreground'
          }`}
        >
          {value}
        </p>
        <p className="text-sm text-neutral-400">{label}</p>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        {isPlaceholder ? 'Awaiting live aggregate' : 'Live aggregate'}
      </p>
    </div>
  );
}
