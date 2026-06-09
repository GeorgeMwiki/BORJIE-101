import { PageHero } from '@/components/shared/PageHero';
import {
  HeadBriefingSurface,
  type BriefingDoc,
} from '@/components/wave9/HeadBriefingSurface';
import { getOwnerSession } from '@/lib/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requirePublicBaseUrl } from '@/lib/env-guard';

export const dynamic = 'force-dynamic';

interface BriefingResult {
  readonly doc: BriefingDoc | null;
  readonly errorMessage: string | null;
}

/**
 * O-W-32 — Head briefing.
 *
 * First-login head screen. Server-fetches the curated briefing document
 * from the gateway head-briefing composer (GET /api/v1/head/briefing),
 * forwarding the verified Supabase bearer exactly as `lib/session.ts` does.
 * Degrades to an honest "unavailable" panel on any failure (composer not
 * wired, network, non-2xx) — never fabricates a briefing.
 */
async function fetchBriefing(): Promise<BriefingResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return { doc: null, errorMessage: 'No active session.' };

    const base = requirePublicBaseUrl(
      'NEXT_PUBLIC_API_GATEWAY_URL',
      'http://localhost:3001',
    ).replace(/\/+$/, '');

    const res = await fetch(`${base}/api/v1/head/briefing`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => null)) as
      | { success?: boolean; data?: BriefingDoc; error?: { message?: string } }
      | null;
    if (!res.ok || !body?.success || !body.data) {
      return {
        doc: null,
        errorMessage: body?.error?.message ?? `Briefing unavailable (${res.status}).`,
      };
    }
    return { doc: body.data, errorMessage: null };
  } catch (err) {
    return {
      doc: null,
      errorMessage: err instanceof Error ? err.message : 'Briefing fetch failed.',
    };
  }
}

export default async function HeadBriefingPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  const { doc, errorMessage } = await fetchBriefing();

  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero slug="head-briefing" />
      <HeadBriefingSurface doc={doc} errorMessage={errorMessage} isSw={isSw} />
    </div>
  );
}
