/**
 * Owner-web BFF proxy helper.
 *
 * Owner-web route handlers under `/api/*` are thin proxies onto the
 * api-gateway. The canonical auth is the Supabase JWT (CLAUDE.md): we read
 * the verified access token server-side via `@supabase/ssr` and forward it
 * as `Authorization: Bearer`, exactly as `lib/session.ts` does for its RSC
 * gateway reads. The gateway re-derives the tenant + role from the token
 * and enforces RLS + four-eye; this module only shapes + forwards.
 *
 * Networking failures collapse to a `success: false` envelope (HTTP 200)
 * so the React layer renders a clean degraded state instead of an opaque
 * fetch error — mirrors the admin-web `lib/proxy.ts` contract.
 */

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from './supabase/server';
import { requirePublicBaseUrl } from './env-guard';

export function gatewayBaseUrl(): string {
  return requirePublicBaseUrl(
    'NEXT_PUBLIC_API_GATEWAY_URL',
    'http://localhost:3001',
  ).replace(/\/+$/, '');
}

async function accessToken(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export interface GatewayProxyOptions {
  readonly method?: 'GET' | 'POST';
  readonly body?: string;
}

/**
 * Forward a request to a gateway path (relative, e.g. `/api/v1/...`) with
 * the verified bearer token and mirror the upstream status + JSON body.
 */
export async function proxyToGateway(
  path: string,
  options: GatewayProxyOptions = {},
): Promise<NextResponse> {
  const method = options.method ?? 'GET';
  const token = await accessToken();
  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHENTICATED', message: 'No active session' } },
      { status: 401 },
    );
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let upstream: Response;
  try {
    upstream = await fetch(`${gatewayBaseUrl()}${path}`, {
      method,
      headers,
      ...(options.body !== undefined ? { body: options.body } : {}),
      cache: 'no-store',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'upstream unreachable';
    return NextResponse.json(
      { success: false, error: { code: 'UPSTREAM_UNREACHABLE', message } },
      { status: 200 },
    );
  }

  const text = await upstream.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (parsed !== null) {
    return NextResponse.json(parsed, { status: upstream.status });
  }
  return NextResponse.json(
    { success: false, error: { code: 'UPSTREAM_EMPTY', message: 'upstream returned an empty body' } },
    { status: upstream.status === 0 ? 502 : upstream.status },
  );
}

/** Read the inbound JSON body as a pre-serialised string, or `null`. */
export async function readJsonBody(req: Request): Promise<string | null> {
  try {
    const json = await req.json();
    return JSON.stringify(json ?? {});
  } catch {
    return null;
  }
}
