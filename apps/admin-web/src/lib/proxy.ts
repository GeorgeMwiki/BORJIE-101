/**
 * Shared upstream-proxy helper for admin-web Next route
 * handlers.
 *
 * Most `/api/platform/*` routes are thin proxies onto the api-gateway
 * (`process.env.API_GATEWAY_URL`). This module owns:
 *
 *   - base-URL resolution + production guards,
 *   - cookie / Authorization header forwarding,
 *   - a structured `success: false` envelope when the upstream is
 *     unreachable (so the React UI sees a clean degraded state instead
 *     of an opaque "fetch failed").
 *
 * Production guard: when `NODE_ENV === 'production'` and the relevant
 * env var is unset, `getApiGatewayBase()` throws loudly at first use so
 * misconfigurations are caught at the edge rather than silently routing
 * to localhost in prod.
 */
import { cookies, headers } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

import { PLATFORM_SESSION_COOKIE } from './session';
import { createSupabaseServerClient } from './supabase/server';

/**
 * Read the canonical Supabase access token from the server session.
 *
 * Browser fetches to the `/api/platform/*` BFF routes use
 * `credentials:'include'` and carry NO `Authorization` header, and the
 * scaffold `borjie_platform_session` cookie is never minted — so without
 * this the gateway (which accepts ONLY a Supabase Bearer or its own
 * `borjie-session` cookie) 401s every wave9 governance call. Returns null
 * when there is no session (the proxy then forwards unauthenticated and
 * the gateway returns its normal 401).
 */
async function readServerBearer(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the api-gateway base URL. Throws in production if unset so
 * misconfigurations surface at boot, not on first user request.
 */
export function getApiGatewayBase(): string {
  const raw = process.env.API_GATEWAY_URL?.trim();
  if (raw && raw.length > 0) {
    return raw.replace(/\/$/, '');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'API_GATEWAY_URL is unset — refusing to fall back to localhost in production',
    );
  }
  return 'http://localhost:4000';
}

/**
 * Forward the inbound auth + tracing headers to an upstream request.
 *
 * `host` / `content-length` / `connection` / hop-by-hop headers are
 * dropped automatically because we never copy them.
 */
async function buildForwardHeaders(
  contentType: 'application/json' | 'text/event-stream' | null,
): Promise<Headers> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(PLATFORM_SESSION_COOKIE);
  const incomingHeaders = await headers();
  const out = new Headers();
  const auth = incomingHeaders.get('authorization');
  const requestId = incomingHeaders.get('x-request-id');
  const traceId = incomingHeaders.get('x-trace-id');
  if (auth) {
    // Explicit service-to-service Authorization wins when present.
    out.set('Authorization', auth);
  } else {
    // Browser-originated BFF call: mint the canonical Supabase Bearer from
    // the server session so the gateway's JWT auth is satisfied.
    const bearer = await readServerBearer();
    if (bearer) out.set('Authorization', `Bearer ${bearer}`);
  }
  if (requestId) out.set('x-request-id', requestId);
  if (traceId) out.set('x-trace-id', traceId);
  if (sessionCookie?.value) {
    out.set('Cookie', `${PLATFORM_SESSION_COOKIE}=${sessionCookie.value}`);
  }
  if (contentType) out.set('Content-Type', contentType);
  out.set('Accept', 'application/json');
  return out;
}

export interface ProxyOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  readonly body?: BodyInit | null;
  readonly contentType?: 'application/json' | 'text/event-stream' | null;
  readonly signal?: AbortSignal;
}

/**
 * Forward a request to an upstream URL and return a NextResponse that
 * mirrors the upstream status + body. Networking failures (DNS,
 * ECONNREFUSED, timeout) collapse to a `success: false` envelope so
 * downstream UI fetchers can render an em-dash degraded state.
 */
export async function proxyJson(
  url: string,
  options: ProxyOptions = {},
): Promise<NextResponse> {
  const method = options.method ?? 'GET';
  const contentType = options.contentType ?? (options.body ? 'application/json' : null);
  const forwardHeaders = await buildForwardHeaders(contentType);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method,
      headers: forwardHeaders,
      ...(options.body !== undefined && options.body !== null ? { body: options.body } : {}),
      cache: 'no-store',
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'upstream unreachable';
    return NextResponse.json(
      {
        success: false,
        error: { code: 'UPSTREAM_UNREACHABLE', message },
      },
      // 200 is intentional — the frontend distinguishes success/failure
      // via `success: false`, and a 5xx would short-circuit before we
      // get there. Mirrors the existing /api/platform/overview pattern.
      { status: 200 },
    );
  }

  const text = await upstream.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (body !== null) {
    return NextResponse.json(body, { status: upstream.status });
  }
  return NextResponse.json(
    {
      success: false,
      error: { code: 'UPSTREAM_EMPTY', message: 'upstream returned an empty body' },
    },
    { status: upstream.status === 0 ? 502 : upstream.status },
  );
}

/**
 * Read the inbound request body as JSON for a POST proxy. Returns a
 * pre-serialised string ready to forward, or `null` if the body is
 * missing or unparseable.
 */
export async function readJsonBody(req: NextRequest): Promise<string | null> {
  try {
    const json = await req.json();
    return JSON.stringify(json ?? {});
  } catch {
    return null;
  }
}
