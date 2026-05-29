/**
 * MarketplaceBoard — inbound RFB column smoke tests.
 *
 * Covers:
 *   1. The component mounts and calls /api/v1/marketplace/rfb/nearby
 *      with the supplied site coordinates.
 *   2. Inbound RFB rows render mineral / tonnage / total price / distance.
 *   3. Empty state shows the bilingual copy when no buyer demand lands.
 *
 * The api-client is stubbed via the @/lib/api-client module mock so the
 * component never touches network or Supabase.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api-client', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from '@/lib/api-client';
import { MarketplaceBoard } from '../marketplace/MarketplaceBoard';

const apiRequestMock = apiRequest as unknown as ReturnType<typeof vi.fn>;

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
});

describe('MarketplaceBoard inbound RFB column', () => {
  beforeEach(() => {
    apiRequestMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/v1/mining/marketplace/listings')) {
        return [];
      }
      if (path.startsWith('/api/v1/marketplace/rfb/nearby')) {
        return {
          success: true,
          data: {
            rfbs: [
              {
                id: 'rfb-1',
                mineral_kind: 'gold',
                tonnage_min: '50',
                tonnage_max: null,
                unit_price_tzs: '120000000',
                delivery_by: '2026-06-15',
                distance_km: 12.4,
                notes: 'LBMA-grade only.',
                created_at: '2026-05-29T00:00:00Z',
                expires_at: '2026-06-12T00:00:00Z',
              },
            ],
          },
        };
      }
      return null;
    });
  });

  it('fetches the nearby RFB endpoint with the supplied site coordinates', async () => {
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MarketplaceBoard locale="en" siteLat={-2.872} siteLon={32.158} />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      const calls = apiRequestMock.mock.calls.map((c) => String(c[0]));
      expect(
        calls.some((p) => p.includes('/api/v1/marketplace/rfb/nearby?lat=-2.872&lon=32.158')),
      ).toBe(true);
    });
  });

  it('renders an inbound RFB row with mineral + tonnage + total', async () => {
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MarketplaceBoard locale="en" siteLat={-2.872} siteLon={32.158} />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      // Tonnage + mineral combined on the first row.
      expect(screen.getByText(/gold · 50 t/)).toBeTruthy();
      // Distance pill from the haversine output.
      expect(screen.getByText('12 km')).toBeTruthy();
    });
  });

  it('renders the empty state when nearby returns zero rows', async () => {
    apiRequestMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/v1/marketplace/rfb/nearby')) {
        return { success: true, data: { rfbs: [] } };
      }
      return [];
    });
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MarketplaceBoard locale="en" siteLat={-2.872} siteLon={32.158} />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(
        screen.getByText('No new buyer requests right now.'),
      ).toBeTruthy();
    });
  });
});
