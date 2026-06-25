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
import { pickByLocale } from '@/lib/locale-shared';
import { localizeApiError } from '@borjie/error-catalog';

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
  /**
   * Locale-NEUTRAL failure marker: the gateway error CODE when present, or a
   * synthesized code, or `null` on success. The page localizes it through
   * `localizeApiError` — the raw wire message never reaches the render (a raw
   * English diagnostic under `sw` is language mixing).
   */
  errorCode: string | null;
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
      return { sessions: [], errorCode: `HTTP_${res.status}` };
    }
    const body = (await res.json()) as ApiEnvelope<{
      sessions: RecentSession[];
    }>;
    if (!body.success || !body.data) {
      return { sessions: [], errorCode: body.error?.code ?? 'UNKNOWN' };
    }
    return { sessions: body.data.sessions, errorCode: null };
  } catch {
    // Network / parse failure — a sentinel code (not the raw English
    // diagnostic) so the page still surfaces an error, localized via the
    // catalog's generic fallback rather than leaking the wire message.
    return { sessions: [], errorCode: 'NETWORK_ERROR' };
  }
}

export default async function SessionReplayLandingPage() {
  const [{ sessions, errorCode }, locale] = await Promise.all([
    fetchRecentSessions(),
    readLocaleFromServerCookies(),
  ]);
  const error = errorCode ? localizeApiError(errorCode, locale) : null;
  return (
    <PageShell
      title={pickByLocale(locale, {
        en: 'Session replay',
        sw: 'Uchezaji wa kipindi',
      })}
      subtitle={pickByLocale(locale, {
        en:
          'Cold-store playback of operator sessions. rrweb events are ' +
          'PII-masked at capture; the brain never sees the bytes.',
        sw:
          'Uchezaji wa vipindi vya waendeshaji kutoka hifadhi baridi. ' +
          'Matukio ya rrweb hufichwa PII wakati wa kunasa; ubongo ' +
          'hauoni baiti hizo kamwe.',
      })}
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
