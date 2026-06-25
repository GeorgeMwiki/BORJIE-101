import { PageHero } from '@/components/shared/PageHero';
import {
  HeadBriefingSurface,
  type BriefingDoc,
  type BriefingErrorCode,
} from '@/components/wave9/HeadBriefingSurface';
import { getOwnerSession } from '@/lib/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requirePublicBaseUrl } from '@/lib/env-guard';

export const dynamic = 'force-dynamic';

interface BriefingResult {
  readonly doc: BriefingDoc | null;
  // A locale-NEUTRAL code (never a raw English sentence — that leaks under
  // `sw`); the surface localises it at render.
  readonly errorCode: BriefingErrorCode | null;
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
    if (!token) return { doc: null, errorCode: 'noSession' };

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
      // The gateway's English `error.message` is NOT surfaced (it would leak
      // under `sw`); the surface renders the localised "unavailable" copy.
      return { doc: null, errorCode: 'unavailable' };
    }
    return { doc: body.data, errorCode: null };
  } catch {
    return { doc: null, errorCode: 'fetchFailed' };
  }
}

export default async function HeadBriefingPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  const { doc, errorCode } = await fetchBriefing();

  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero slug="head-briefing" />
      <HeadBriefingSurface doc={doc} errorCode={errorCode} isSw={isSw} />
    </div>
  );
}
