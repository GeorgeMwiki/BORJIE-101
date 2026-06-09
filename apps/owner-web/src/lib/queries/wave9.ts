/**
 * Wave 9 owner-web client API — Head Briefing (read-only) and MD-Agentic
 * sandbox-writes review queue. Both front already-mounted gateway routes
 * via the owner-web `/api/*` BFF proxies, which forward the verified
 * Supabase bearer. Failures throw so react-query's `error` channel renders
 * a clean degraded state.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCsrfHeaders } from '@/lib/csrf';

interface Envelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { readonly message?: string; readonly code?: string };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !body?.success || body.data === undefined) {
    throw new Error(
      body?.error?.message ?? `request failed (${body?.error?.code ?? res.status})`,
    );
  }
  return body.data;
}

async function sendJson<T>(url: string, payload?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
    body: JSON.stringify(payload ?? {}),
  });
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !body?.success || body.data === undefined) {
    throw new Error(
      body?.error?.message ?? `request failed (${body?.error?.code ?? res.status})`,
    );
  }
  return body.data;
}

// ─── MD-Agentic sandbox writes ───────────────────────────────────────────────

export interface SandboxWrite {
  readonly id: string;
  readonly targetTable?: string;
  readonly target_table?: string;
  readonly status?: string;
  readonly operation?: string;
  readonly summary?: string;
  readonly rationale?: string;
  readonly createdAt?: string;
  readonly created_at?: string;
  readonly payload?: Record<string, unknown>;
}

interface SandboxListData {
  readonly statusFilter: string;
  readonly tableFilter: string;
  readonly count: number;
  readonly sandboxWrites: ReadonlyArray<SandboxWrite>;
}

const SANDBOX_KEY = (status: string) => ['wave9', 'md-agentic', 'sandbox', status] as const;

export function useSandboxWrites(status: string) {
  return useQuery<SandboxListData>({
    queryKey: SANDBOX_KEY(status),
    queryFn: () =>
      getJson<SandboxListData>(
        `/api/md-agentic/sandbox-writes?status=${encodeURIComponent(status)}`,
      ),
  });
}

export function useCommitSandboxWrite(status: string) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (id: string) =>
      sendJson(`/api/md-agentic/sandbox-writes/${encodeURIComponent(id)}/commit`),
    onSettled: () => qc.invalidateQueries({ queryKey: SANDBOX_KEY(status) }),
  });
}

export interface RejectSandboxInput {
  readonly id: string;
  readonly reason: string;
}

export function useRejectSandboxWrite(status: string) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, RejectSandboxInput>({
    mutationFn: (input: RejectSandboxInput) =>
      sendJson(`/api/md-agentic/sandbox-writes/${encodeURIComponent(input.id)}/reject`, {
        reason: input.reason,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: SANDBOX_KEY(status) }),
  });
}
