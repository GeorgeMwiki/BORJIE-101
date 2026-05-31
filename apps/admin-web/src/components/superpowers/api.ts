/**
 * Wave SUPERPOWERS (admin-web) — HTTP helpers for chip dispatch.
 *
 * Admin reuses the owner-side share-links / pinned-items / undo-journal
 * routes (they are tenant-scoped via the Supabase JWT, and admin staff
 * carry their own tenant scope). Bulk-action targets the admin-specific
 * route `/api/v1/admin/superpowers/bulk-action` which carries the
 * admin whitelist + four-eye gating.
 */

import { API_BASE } from '@/lib/brain-api';
import { getCsrfHeaders } from '@/lib/csrf';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

async function getAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function postSuperpowerJson<T>(
  path: string,
  body: unknown,
): Promise<T | null> {
  try {
    const token = await getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...getCsrfHeaders(),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: T };
    return json.success && json.data ? json.data : null;
  } catch {
    return null;
  }
}

/** Paths the admin chip layer hits. Centralised so tests + tooling
 *  can grep one place. */
export const ADMIN_SUPERPOWER_ENDPOINTS = Object.freeze({
  prefillAck: '/api/v1/owner/superpowers/prefill',
  shareLinkCreate: '/api/v1/owner/share-links',
  bookmarkPin: '/api/v1/owner/pinned-items',
  undoLast: '/api/v1/owner/undo-journal/undo-last',
  // The one route that is genuinely admin-distinct: it carries the
  // tenant_orgs / intelligence_corpus / feature_flags whitelist.
  adminBulkAction: '/api/v1/admin/superpowers/bulk-action',
} as const);
