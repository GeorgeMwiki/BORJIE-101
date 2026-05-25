import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { PLATFORM_SESSION_COOKIE } from '@/lib/session';
import { getIdentityBase, proxyJson } from '@/lib/proxy';

/**
 * Return the current staff session via the identity service.
 *
 * Forwards the platform session cookie to the identity service's
 * `GET /sessions/verify` (or `/me`) endpoint and mirrors its response.
 * Unauthenticated callers short-circuit before any upstream call.
 *
 * In production `IDENTITY_URL` must be set; the proxy helper throws if
 * not. In dev it falls back to `http://localhost:4001`.
 */
export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get(PLATFORM_SESSION_COOKIE)?.value;
  if (!session || session.length === 0) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const identityBase = getIdentityBase();
  return proxyJson(`${identityBase}/sessions/verify`, { method: 'GET' });
}
