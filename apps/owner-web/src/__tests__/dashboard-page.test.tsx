/**
 * Owner-web dashboard surface — render tests.
 *
 * Covers:
 *   1. Loading skeleton renders while the brief query is in-flight.
 *   2. Error state renders with a link back to `/` (chat home) when
 *      the gateway returns a non-2xx.
 *   3. Happy path renders all seven slot panels with their testids.
 *   4. AiDailyBriefPanel happy path + empty path.
 *   5. AlertQueuePanel collapses decisions + incidents and renders an
 *      empty state when both are zero.
 *   6. KpiStripPanel renders five tiles and surfaces sparklines only
 *      when the per-site array has 3+ rows.
 *   7. ProductionVsTargetTable renders rows + empty state.
 *
 * The brain wire is not exercised here; the surface only hits
 * `GET /api/v1/owner/brief` via a stubbed fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { OwnerDashboardSurface } from '@/components/dashboard/OwnerDashboardSurface';
import { AiDailyBriefPanel } from '@/components/dashboard/AiDailyBriefPanel';
import { AlertQueuePanel } from '@/components/dashboard/AlertQueuePanel';
import { KpiStripPanel } from '@/components/dashboard/KpiStripPanel';
import { ProductionVsTargetTable } from '@/components/dashboard/ProductionVsTargetTable';
import type { OwnerBriefEnvelope } from '@/lib/queries/owner-brief';

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => ({
    get: (_key: string): string | null => null,
  }),
}));

function withClient(ui: ReactNode): JSX.Element {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function buildEnvelope(): OwnerBriefEnvelope {
  return {
    brief: {
      schemaVersion: 1,
      composedAtIso: new Date('2026-05-27T06:00:00Z').toISOString(),
      dailyBrief: {
        date: '2026-05-27',
        shiftsToday: 3,
        openIncidents: 2,
        openGrievances: 1,
        criticalIncidents: 1,
      },
      decisions: {
        pendingCount: 2,
        items: [
          {
            id: 'd1',
            kind: 'incident',
            summary: 'Roof bolt review pending',
            severity: 'high',
          },
          {
            id: 'd2',
            kind: 'licence',
            summary: 'PML 25434 renewal',
            severity: 'medium',
          },
        ],
      },
      cashRunway: {
        ninetyDayNetTzs: 1_800_000_000,
        dailyAvgTzs: 20_000_000,
        sampleCount: 42,
      },
      productionVsTarget: {
        window: '30d',
        perSite: [
          { siteId: 'site-a', tonnes: 120, fuel: 480, shifts: 8 },
          { siteId: 'site-b', tonnes: 95, fuel: 360, shifts: 7 },
          { siteId: 'site-c', tonnes: 60, fuel: 240, shifts: 5 },
        ],
      },
      cliffStatus: {
        cliffDateIso: '2026-03-27T00:00:00Z',
        postCliffSales: 0,
        usdDenominated: 1,
        remediationComplete: false,
      },
      openHighIncidents: {
        count: 1,
        items: [
          {
            id: 'i1',
            severity: 'high',
            kind: 'rockfall',
            occurredAt: '2026-05-26T10:00:00Z',
          },
        ],
      },
      licenceHealth: {
        totalCount: 4,
        atRiskCount: 1,
        items: [
          {
            id: 'l1',
            number: 'PML 25434',
            kind: 'PML',
            daysToExpiry: 28,
            atRisk: true,
          },
          {
            id: 'l2',
            number: 'PML 25500',
            kind: 'PML',
            daysToExpiry: 720,
            atRisk: false,
          },
        ],
      },
    },
    source: 'cron',
    generatedAt: new Date('2026-05-27T06:00:00Z').toISOString(),
    cached: true,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'http://localhost:9999';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_API_GATEWAY_URL;
});

describe('OwnerDashboardSurface · loading state', () => {
  it('shows the skeleton tiles while the brief query is in-flight', () => {
    const fetchMock = vi.fn(
      () => new Promise<Response>(() => {}), // never resolves
    );
    vi.stubGlobal('fetch', fetchMock);
    render(withClient(<OwnerDashboardSurface />));
    expect(screen.getByTestId('owner-dashboard-skeleton')).toBeTruthy();
  });
});

describe('OwnerDashboardSurface · error state references the chat home', () => {
  it('renders the offline panel with a link back to `/` when the gateway errors', async () => {
    const fetchMock = vi.fn(
      async () => new Response('gateway down', { status: 503 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(withClient(<OwnerDashboardSurface />));
    await waitFor(() => {
      expect(screen.getByTestId('owner-dashboard-error')).toBeTruthy();
    });
    const link = screen.getByText('home chat');
    expect(link.getAttribute('href')).toBe('/');
  });
});

describe('OwnerDashboardSurface · happy path renders all seven slots', () => {
  it('mounts the surface and each panel testid after the brief resolves', async () => {
    const envelope = buildEnvelope();
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, data: envelope }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(withClient(<OwnerDashboardSurface />));
    await waitFor(() => {
      expect(screen.getByTestId('owner-dashboard-surface')).toBeTruthy();
    });
    expect(screen.getByTestId('dashboard-daily-brief')).toBeTruthy();
    expect(screen.getByTestId('dashboard-alert-queue')).toBeTruthy();
    expect(screen.getByTestId('dashboard-kpi-strip')).toBeTruthy();
    expect(screen.getByTestId('dashboard-production-table')).toBeTruthy();
    expect(screen.getByTestId('dashboard-cash-runway')).toBeTruthy();
    expect(screen.getByTestId('dashboard-compliance-safety')).toBeTruthy();
    expect(screen.getByTestId('dashboard-quick-actions')).toBeTruthy();
  });
});

describe('AiDailyBriefPanel · empty state when all counters are zero', () => {
  it('shows the empty copy referencing /', () => {
    render(
      <AiDailyBriefPanel
        dailyBrief={{
          date: '2026-05-27',
          shiftsToday: 0,
          openIncidents: 0,
          openGrievances: 0,
          criticalIncidents: 0,
        }}
      />,
    );
    expect(screen.getByTestId('dashboard-daily-brief-empty')).toBeTruthy();
  });

  it('renders the metric grid when counters are populated', () => {
    render(
      <AiDailyBriefPanel
        dailyBrief={{
          date: '2026-05-27',
          shiftsToday: 3,
          openIncidents: 2,
          openGrievances: 1,
          criticalIncidents: 1,
        }}
      />,
    );
    expect(screen.queryByTestId('dashboard-daily-brief-empty')).toBeNull();
    expect(screen.getByText('Shifts logged')).toBeTruthy();
  });
});

describe('AlertQueuePanel · merges decisions and incidents', () => {
  it('renders the empty copy when both queues are empty', () => {
    render(
      <AlertQueuePanel
        decisions={{ pendingCount: 0, items: [] }}
        incidents={{ count: 0, items: [] }}
      />,
    );
    expect(screen.getByTestId('dashboard-alert-queue-empty')).toBeTruthy();
  });

  it('caps the rendered alert rows at eight and prefixes incidents first', () => {
    const decisions = Array.from({ length: 6 }).map((_, i) => ({
      id: `d${i}`,
      kind: 'incident',
      summary: `Decision ${i}`,
      severity: 'medium',
    }));
    const incidents = Array.from({ length: 4 }).map((_, i) => ({
      id: `i${i}`,
      severity: i % 2 === 0 ? 'critical' : 'high',
      kind: 'rockfall',
      occurredAt: null,
    }));
    render(
      <AlertQueuePanel
        decisions={{ pendingCount: decisions.length, items: decisions }}
        incidents={{ count: incidents.length, items: incidents }}
      />,
    );
    const rows = screen.getAllByTestId('dashboard-alert-row');
    expect(rows).toHaveLength(8);
  });
});

describe('KpiStripPanel · renders five tiles with conditional sparklines', () => {
  it('mounts all five tile testids and only sparks production when 3+ sites contribute', () => {
    const envelope = buildEnvelope();
    render(<KpiStripPanel brief={envelope.brief} />);
    expect(screen.getByTestId('kpi-production')).toBeTruthy();
    expect(screen.getByTestId('kpi-cash')).toBeTruthy();
    expect(screen.getByTestId('kpi-safety')).toBeTruthy();
    expect(screen.getByTestId('kpi-licence')).toBeTruthy();
    expect(screen.getByTestId('kpi-cliff')).toBeTruthy();
    expect(screen.getByTestId('kpi-production-spark')).toBeTruthy();
  });
});

describe('ProductionVsTargetTable · empty + populated', () => {
  it('renders the empty copy when no sites have reported', () => {
    render(
      <ProductionVsTargetTable production={{ window: '30d', perSite: [] }} />,
    );
    expect(screen.getByTestId('dashboard-production-empty')).toBeTruthy();
  });

  it('renders one row per site when the slot has data', () => {
    render(
      <ProductionVsTargetTable
        production={{
          window: '30d',
          perSite: [
            { siteId: 'a', tonnes: 100, fuel: 200, shifts: 5 },
            { siteId: 'b', tonnes: 80, fuel: 160, shifts: 4 },
          ],
        }}
      />,
    );
    expect(screen.getAllByTestId('dashboard-production-row')).toHaveLength(2);
  });
});
