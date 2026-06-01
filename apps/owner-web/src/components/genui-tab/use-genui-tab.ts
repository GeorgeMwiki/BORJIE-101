'use client';

/**
 * useGenuiTab — fetch one MD-authored `PortalTab` by id from the gateway.
 *
 * Hits `GET /api/v1/portal-genui/tabs/:id`. The route returns
 * `{ success, data: { tab } }`; `apiRequest` unwraps the envelope to the
 * inner `{ tab }`. The tab is re-validated here with the package's
 * `safeParsePortalTab` so a shape drift between server + client surfaces as
 * an empty state rather than a render crash.
 *
 * LIVE-only (matches api-client.ts): no mock fallback. Loading / error /
 * not-found are first-class so the host renders a clean empty state.
 */

import { useEffect, useRef, useState } from 'react';
import { safeParsePortalTab, type PortalTab } from '@borjie/portal-genui';

import { apiRequest, ApiError } from '@/lib/api-client';

export type GenuiTabFetchState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly tab: PortalTab }
  | { readonly status: 'not_found' }
  | { readonly status: 'error'; readonly message: string };

export function useGenuiTab(tabId: string | null | undefined): GenuiTabFetchState {
  const [state, setState] = useState<GenuiTabFetchState>(
    tabId ? { status: 'loading' } : { status: 'not_found' },
  );
  // Guard against setState after unmount / id change.
  const activeId = useRef<string | null>(tabId ?? null);

  useEffect(() => {
    activeId.current = tabId ?? null;
    if (!tabId) {
      setState({ status: 'not_found' });
      return;
    }
    setState({ status: 'loading' });
    const controller = new AbortController();

    (async () => {
      try {
        const data = await apiRequest<{ tab: unknown }>(
          `/api/v1/portal-genui/tabs/${encodeURIComponent(tabId)}`,
          { signal: controller.signal },
        );
        if (activeId.current !== tabId) return;
        const tab = safeParsePortalTab(data?.tab);
        if (!tab) {
          setState({ status: 'not_found' });
          return;
        }
        setState({ status: 'ready', tab });
      } catch (err) {
        if (activeId.current !== tabId) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: 'not_found' });
          return;
        }
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'failed to load tab',
        });
      }
    })();

    return () => controller.abort();
  }, [tabId]);

  return state;
}
