'use client';
/**
 * BorjieWidgetMount — owner-web authenticated wrapper around the
 * @borjie/chat-ui FloatingAskBorjie widget.
 *
 * Reads the Supabase access token from the browser client and forwards
 * it to the widget's `getAccessToken` callback. The widget renders a
 * "Sign in to talk to Borjie" prompt if the token is null (unauthenticated
 * session), otherwise streams responses via /api/v1/mining/chat.
 */
import { FloatingAskBorjie } from '@borjie/chat-ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

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
