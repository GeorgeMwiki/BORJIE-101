import { NextResponse } from 'next/server';

/**
 * Liveness probe for the admin-web. Public (no auth) so the
 * ops mesh can hit it without a session cookie. See `src/middleware.ts`.
 */
export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'admin-web',
  });
}
