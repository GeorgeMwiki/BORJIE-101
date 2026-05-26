/**
 * Client-side API helper used by HQ pages migrated from the deprecated
 * admin-portal app.
 *
 * The admin-web is staff-only. Authentication is the
 * httpOnly platform-session cookie set by the identity service —
 * `credentials: 'include'` ensures it rides every request. A bearer
 * token in `sessionStorage.platform_token`, if present, is forwarded
 * as `Authorization: Bearer …` for callers that can't use cookies.
 * Requests target the api-gateway directly via NEXT_PUBLIC_API_URL.
 */

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Resolve the API base lazily on each request — module-load-time throws
 * break Next's prerender (the migrated client pages are imported by
 * SSR even though they're 'use client'). When NEXT_PUBLIC_API_URL is
 * unset we fall back to a same-origin '/api/v1', which is the right
 * behaviour for both build-time and runtime: at runtime the platform
 * portal is fronted by the same gateway, and at build time the request
 * never actually fires because the components are client-only fetchers.
 */
function getApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    const trimmed = configured.replace(/\/$/, '');
    return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
  }
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:4000/api/v1';
  }
  return '/api/v1';
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  // The platform session is held in an httpOnly cookie set by the
  // identity service (see middleware.ts + lib/session.ts). We send
  // `credentials: 'include'` below so that cookie reaches the gateway.
  // `sessionStorage.platform_token` is a complementary bearer the login
  // flow may stash for non-cookie callers (e.g. EventSource); when
  // present we forward it as `Authorization: Bearer …`.
  const token =
    typeof window !== 'undefined'
      ? window.sessionStorage.getItem('platform_token')
      : null;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const apiBase = getApiBase();
  try {
    const response = await fetch(`${apiBase}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include',
    });

    let parsed: { data?: T; error?: { message?: string }; message?: string };
    try {
      parsed = (await response.json()) as typeof parsed;
    } catch {
      parsed = {};
    }

    if (!response.ok) {
      return {
        success: false,
        error: parsed.error?.message ?? parsed.message ?? `HTTP ${response.status}`,
      };
    }

    return { success: true, data: parsed.data as T };
  } catch (error) {
    console.error('Platform API request failed:', error);
    return { success: false, error: 'Network error' };
  }
}

export const api = {
  get: <T>(endpoint: string) => request<T>(endpoint),
  post: <T>(endpoint: string, data: unknown) =>
    request<T>(endpoint, { method: 'POST', body: JSON.stringify(data) }),
  put: <T>(endpoint: string, data: unknown) =>
    request<T>(endpoint, { method: 'PUT', body: JSON.stringify(data) }),
  patch: <T>(endpoint: string, data: unknown) =>
    request<T>(endpoint, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, {
      method: 'DELETE',
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }),
};

export function formatCurrency(
  amount: number,
  currency = 'USD',
  locale = 'en'
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: string | Date, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}
