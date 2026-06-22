/**
 * Session replay landing page — Central Command Phase B (B5) +
 * Phase C (C4 search + filter).
 *
 * Lists recent sessions for the tenant. Click-through navigates to
 * `/session-replay/<sessionId>` which renders the rrweb-player.
 *
 * Admin-gated by the staff layout (SUPER_ADMIN + ADMIN). The gateway
 * also enforces the role gate at the API tier — defence-in-depth.
 *
 * Phase C C4: the table is wrapped in a client-side filter shell that
 * provides free-text search + facet filters (date / errors / duration).
 * The deep link to `[sessionId]/page.tsx` is untouched.
 */

import { cookies } from 'next/headers';
import { PageShell } from '@/components/migrated/PageShell';
import { SessionReplayList } from './_filters';
import { requirePublicBaseUrl } from '@/lib/env-guard';
import { PLATFORM_SESSION_COOKIE } from '@/lib/session';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

interface RecentSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly surface: string;
  readonly firstCapturedAt: string;
  readonly lastCapturedAt: string;
  readonly chunkCount: number;
  readonly errorEventCount?: number;
  readonly tenantName?: string;
}

interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { code: string; message?: string };
}

async function fetchRecentSessions(): Promise<{
  sessions: RecentSession[];
  error: string | null;
}> {
  try {
    const base = requirePublicBaseUrl(
      'NEXT_PUBLIC_API_BASE_URL',
      'http://localhost:3001',
    );
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(PLATFORM_SESSION_COOKIE);
    const fetchHeaders: HeadersInit = {};
    if (sessionCookie?.value) {
      fetchHeaders['Cookie'] =
        `${PLATFORM_SESSION_COOKIE}=${sessionCookie.value}`;
    }
    const res = await fetch(
      `${base.replace(/\/$/, '')}/api/v1/session-replay/sessions`,
      {
        cache: 'no-store',
        headers: fetchHeaders,
      },
    );
    if (!res.ok) {
      return {
        sessions: [],
        error: `Recent-sessions fetch failed (${res.status})`,
      };
    }
    const body = (await res.json()) as ApiEnvelope<{
      sessions: RecentSession[];
    }>;
    if (!body.success || !body.data) {
      return {
        sessions: [],
        error: body.error?.message ?? 'API returned an error envelope',
      };
    }
    return { sessions: body.data.sessions, error: null };
  } catch (err) {
    return {
      sessions: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default async function SessionReplayLandingPage() {
  const [{ sessions, error }, locale] = await Promise.all([
    fetchRecentSessions(),
    readLocaleFromServerCookies(),
  ]);
  return (
    <PageShell
      title="Session replay"
      subtitle="Cold-store playback of operator sessions. rrweb events are PII-masked at capture; the brain never sees the bytes."
    >
      {error ? (
        <div className="mb-4 rounded-md border border-warning bg-warning-subtle p-4 text-sm text-warning">
          {error}
        </div>
      ) : null}
      <SessionReplayList sessions={sessions} initialLocale={locale} />
    </PageShell>
  );
}
