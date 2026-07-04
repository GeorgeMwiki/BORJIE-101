/**
 * SalesSurface KPI strip — whole-book revenue (Track B6).
 *
 * DEFECT (RED): the KPI strip folded totalNet / totalGross from the fetched
 * page (≤100 rows), so a tenant with more sales than the page size saw a
 * fabricated-low "Total Net/Gross Revenue".
 *
 * FIX (GREEN): the backend folds the totals in SQL over the WHOLE book and
 * serves them on the sibling `GET /api/v1/mining/sales/summary` (survives
 * apiRequest's envelope-unwrap); the strip renders those totals. This test
 * resolves a /summary aggregate that disagrees with a fold over the two
 * returned rows and asserts the strip shows the whole-book number (987,654),
 * never the misleading paged fold (20).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { SalesSurface } from '../SalesSurface';

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => ({ get: (): string | null => null }),
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Two paged rows that would fold to a NET of 20 client-side. */
const pagedRows = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    parcelId: '22222222-2222-2222-2222-222222222222',
    buyerId: null,
    route: 'trader',
    grossPriceTzs: 12,
    netTzs: 10,
    paymentStatus: 'paid',
    ts: '2026-06-01T10:00:00.000Z',
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    parcelId: '44444444-4444-4444-4444-444444444444',
    buyerId: null,
    route: 'trader',
    grossPriceTzs: 12,
    netTzs: 10,
    paymentStatus: 'paid',
    ts: '2026-06-02T10:00:00.000Z',
  },
];

describe('SalesSurface · KPI strip reads the whole-book summary', () => {
  it('renders the server aggregate total, not the fold over the paged rows', async () => {
    // Two endpoints: the list returns the paged rows; the sibling /summary
    // returns the whole-book aggregate (250 sales) — SUMs as strings.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/sales/summary')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              totalNetTzs: '987654',
              totalGrossTzs: '1234567',
              count: 250,
              pendingCount: 40,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ success: true, data: pagedRows }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(withClient(<SalesSurface initialLocale="en" />));

    // The KPI strip shows the WHOLE-BOOK totals from the summary …
    await waitFor(() => {
      expect(screen.getByText(/987,654/)).toBeTruthy();
    });
    expect(screen.getByText(/1,234,567/)).toBeTruthy();
    // … the total-sales count is the aggregate 250, not the 2 paged rows …
    expect(screen.getByText('250')).toBeTruthy();
    expect(screen.getByText('40')).toBeTruthy();

    // … and the misleading paged-fold net (TZS 20) never appears as a KPI.
    expect(screen.queryByText('TZS 20')).toBeNull();
  });
});
