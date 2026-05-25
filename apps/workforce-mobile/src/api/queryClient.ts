import { QueryClient } from '@tanstack/react-query'

/**
 * Single shared QueryClient. Conservative defaults: long stale time, no
 * window-focus refetch (mobile only), retry once on transient errors.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true
      },
      mutations: {
        retry: 0
      }
    }
  })
}
