'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * Single QueryClient instance per browser tab. Mounted by the internal
 * layout so every /internal/* page gets the same cache.
 *
 * staleTime is generous (30s) because most admin surfaces are
 * latency-tolerant — operators are looking at directory listings, not
 * trading screens. Mutations invalidate the relevant queries explicitly.
 */
export function QueryProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
