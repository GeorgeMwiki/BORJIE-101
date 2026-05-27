/**
 * Admin-web home (chat-first).
 *
 * The internal Borjie team uses chat as their primary entry point:
 * investigate tenants, dispatch jobs, query data — all through a single
 * conversational surface. The previous "Platform HQ" card grid moved to
 * /internal (which already holds the screen catalogue) and the live
 * cross-tenant cards (/industry, /radar, /insights, /forecasts) keep
 * their own routes for deep dives.
 *
 * This page is a Server Component that:
 *   1. Confirms a Supabase session via `createSupabaseServerClient`.
 *      The Next.js middleware already redirects unauthenticated traffic
 *      to /sign-in, but we double-gate here so any SSR path that bypasses
 *      middleware (eg. internal route forwarding) still fails closed.
 *   2. Renders the client-side `<HomeChat />` surface. `HomeChat`
 *      provides its own QueryProvider so the layout does not need to
 *      change.
 *
 * Persona: every brain turn forwarded by `useAskBorjie` carries
 * `forcePersonaId: 'T2_admin_strategist'` so the orchestrator routes
 * messages to the tier-2 all-tenant seed (see
 * `packages/persona-runtime/src/seeds.ts`).
 */

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { HomeChat } from '@/components/home-chat/HomeChat';

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirect('/sign-in?next=/');
  }

  return <HomeChat />;
}
