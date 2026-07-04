/**
 * Ops-tab KPI-strip counts (Track B9 regression).
 *
 * The three Ops tiles (Producing sites / Open incidents / On shift) used to
 * be a hardcoded `const PENDING = '—'` with no data path, so they read '—'
 * FOREVER even while the sibling <SitesList>/<SafetySurface> below them
 * rendered the real rows. `useOpsSnapshotCounts` wires each tile to the SAME
 * live endpoint its sibling surface uses. This proves that, given fixture
 * data on those endpoints, the hook yields the real derived counts — and
 * that an unresolved source reads an honest '—', never a fabricated 0.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useOpsSnapshotCounts } from '../useOpsSnapshotCounts';

const apiRequest = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiRequest: (...args: readonly unknown[]) => apiRequest(...args),
}));

function wrapper({ children }: { readonly children: ReactNode }): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  apiRequest.mockReset();
});

describe('useOpsSnapshotCounts', () => {
  it('derives real counts from the live sibling endpoints', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/mining/sites')) {
        return Promise.resolve([
          { id: 's1', name: 'North Pit', phase: 'Production' },
          { id: 's2', name: 'South Pit', phase: 'production' },
          { id: 's3', name: 'West Block', phase: 'Development' },
        ]);
      }
      if (path.startsWith('/api/v1/mining/incidents')) {
        return Promise.resolve([
          { id: 'i1', siteId: 's1', kind: 'rockfall', severity: 'high', occurredAt: null, status: 'open' },
          { id: 'i2', siteId: 's2', kind: 'spill', severity: 'low', occurredAt: null, status: 'open' },
        ]);
      }
      if (path.startsWith('/api/v1/mining/attendance/headcount')) {
        return Promise.resolve({
          groupBy: 'site',
          perSite: [
            { siteId: 's1', headcount: 40 },
            { siteId: 's2', headcount: 22 },
          ],
        });
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const { result } = renderHook(() => useOpsSnapshotCounts(), { wrapper });

    await waitFor(() => {
      expect(result.current.producingSites).toBe('2');
    });
    expect(result.current.openIncidents).toBe('2');
    expect(result.current.onShift).toBe('62');
  });

  it('renders an honest "—" for a source that has not resolved', () => {
    // Never resolves → query stays pending → tiles must NOT fabricate a 0.
    apiRequest.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useOpsSnapshotCounts(), { wrapper });

    expect(result.current.producingSites).toBe('—');
    expect(result.current.openIncidents).toBe('—');
    expect(result.current.onShift).toBe('—');
  });
});
