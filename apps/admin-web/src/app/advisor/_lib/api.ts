/**
 * Browser-side fetch helpers for the advisor surface.
 *
 * Every page POSTs to `/api/v1/advisor/<name>` on the api-gateway
 * (wired by sibling agent `P2`). We send `credentials: 'include'` so
 * the httpOnly platform-session cookie rides along, and we let the
 * gateway envelope shape (`{ success, data, error }`) flow through
 * unchanged.
 *
 * Zod parses the response in each page so the type system pins the
 * advisor shape at the boundary — no `as` casts inside React.
 */

import { z } from 'zod';

import { getCsrfHeaders } from '@/lib/csrf';

export interface AdvisorEnvelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

function getApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    const trimmed = configured.replace(/\/$/, '');
    return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
  }
  if (
    typeof window !== 'undefined' &&
    window.location.hostname === 'localhost'
  ) {
    return 'http://localhost:4000/api/v1';
  }
  return '/api/v1';
}

export interface PostAdvisorOptions<T> {
  readonly endpoint: string;
  readonly body: unknown;
  readonly schema: z.ZodType<T>;
  readonly signal?: AbortSignal;
}

/**
 * POST to `/api/v1/advisor/<name>` and return a typed envelope.
 * Network + parse failures are folded into `success: false`.
 */
export async function postAdvisor<T>({
  endpoint,
  body,
  schema,
  signal,
}: PostAdvisorOptions<T>): Promise<AdvisorEnvelope<T>> {
  const base = getApiBase();
  const url = `${base}/advisor/${endpoint.replace(/^\//, '')}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return { success: false, error: 'aborted' };
    }
    console.error('postAdvisor network error:', error);
    return { success: false, error: 'Network error reaching api-gateway' };
  }

  let json: { data?: unknown; error?: { message?: string }; message?: string };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    json = {};
  }

  if (!res.ok) {
    return {
      success: false,
      error:
        json.error?.message ??
        json.message ??
        `Upstream returned HTTP ${res.status}`,
    };
  }

  const parsed = schema.safeParse(json.data ?? json);
  if (!parsed.success) {
    return {
      success: false,
      error: `Advisor response did not match contract: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => i.message)
        .join('; ')}`,
    };
  }
  return { success: true, data: parsed.data };
}
