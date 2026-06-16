'use client';
/**
 * BorjieWidgetMount — admin-web authenticated wrapper around the
 * @borjie/chat-ui FloatingAskBorjie widget.
 *
 * Reads the Supabase access token from the browser client and forwards
 * it to the widget. Falls back to a sign-in prompt for unauthenticated
 * sessions; streams responses via /api/v1/mining/chat otherwise.
 *
 * SOTA lazy-load (Wave 15H) — the chat-ui bundle is loaded via
 * `next/dynamic({ ssr: false })` so it never enters the SSR module
 * graph. Cuts SSR JS payload + parse time, and guarantees no future
 * window-touching transitive dep can ever crash boot.
 *
 * owner-genui-12 parity: resolve the gateway base URL through
 * `requirePublicBaseUrl` (same as owner-web) instead of a raw
 * `process.env … ?? ''` read so production builds fail loud when
 * NEXT_PUBLIC_API_GATEWAY_URL is unset rather than silently posting to
 * the admin-web Next.js server itself (which has no /api/v1/mining/chat
 * handler).
 */
import dynamic from 'next/dynamic';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { requirePublicBaseUrl } from '@/lib/env-guard';

const FloatingAskBorjie = dynamic(
  () => import('@borjie/chat-ui').then((m) => m.FloatingAskBorjie),
  { ssr: false },
);

/**
 * Resolved once at module load time. `requirePublicBaseUrl` throws on the
 * server in production when the env var is missing, and returns the
 * localhost fallback in development — consistent with every other
 * admin-web base-URL read (insights / subscriptions / session-replay /
 * industry).
 */
const API_BASE_URL = requirePublicBaseUrl(
  'NEXT_PUBLIC_API_GATEWAY_URL',
  'http://localhost:3001',
);

async function getAccessToken(): Promise<string | null> {
  try {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export function BorjieWidgetMount(): JSX.Element {
  return (
    <FloatingAskBorjie
      variant="authenticated"
      apiBaseUrl={API_BASE_URL}
      getAccessToken={getAccessToken}
      signInHref="/sign-in"
    />
  );
}
