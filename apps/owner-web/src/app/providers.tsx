'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * App-level client providers.
 *
 * Wraps the owner cockpit tree with TanStack Query so server fetches
 * (cockpit cards, chat, document store, treasury) can share a single
 * cache and stale-while-revalidate logic. Created lazily inside a
 * client component so the Next.js RSC tree above stays serialisable.
 *
 * The QueryClient is held in `useState` so React's strict-mode double
 * render does not instantiate two competing caches.
 */
export function AppProviders({ children }: { readonly children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
