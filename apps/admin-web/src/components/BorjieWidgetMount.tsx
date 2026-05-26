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
 */
import dynamic from 'next/dynamic';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const FloatingAskBorjie = dynamic(
  () => import('@borjie/chat-ui').then((m) => m.FloatingAskBorjie),
  { ssr: false },
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
      apiBaseUrl={process.env.NEXT_PUBLIC_API_GATEWAY_URL ?? ''}
      getAccessToken={getAccessToken}
      signInHref="/sign-in"
    />
  );
}
