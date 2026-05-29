'use client';

import { useCallback, useEffect, useState } from 'react';
import { getCsrfHeaders } from '@/lib/csrf';
import { requirePublicBaseUrl } from '@/lib/env-guard';

type AgentToken = {
  readonly id: string;
  readonly clientId: string;
  readonly clientLabel: string | null;
  readonly scopes: readonly string[];
  readonly issuedAt: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
};

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; tokens: readonly AgentToken[] }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

function gatewayBaseUrl(): string {
  // Production builds throw via requirePublicBaseUrl if the env var is
  // missing — avoids silent localhost fetches in deployed cockpit.
  return requirePublicBaseUrl(
    'NEXT_PUBLIC_API_GATEWAY_URL',
    'http://localhost:4001',
  ).replace(/\/$/, '');
}

function formatRelative(input: string | null): string {
  if (!input) return '—';
  const then = new Date(input).getTime();
  if (Number.isNaN(then)) return input;
  const diff = Date.now() - then;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'sasa hivi / just now';
  if (min < 60) return `dakika ${min} zilizopita / ${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `saa ${hr} zilizopita / ${hr}h ago`;
  const day = Math.round(hr / 24);
  return `siku ${day} zilizopita / ${day}d ago`;
}

export function ConnectedAgentsList() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await fetch(
        `${gatewayBaseUrl()}/api/v1/oauth/agent-tokens`,
        { credentials: 'include' },
      );
      const json = (await res.json().catch(() => null)) as
        | { success: true; data: readonly AgentToken[] }
        | { success?: false; error?: { code: string; message: string } }
        | null;
      if (!res.ok || !json || !('success' in json) || !json.success) {
        const message =
          (json && 'error' in json && json.error?.message) ||
          `Tatizo (HTTP ${res.status})`;
        setState({ kind: 'error', message });
        return;
      }
      const tokens = json.data;
      setState(tokens.length === 0 ? { kind: 'empty' } : { kind: 'ready', tokens });
    } catch (err) {
      setState({
        kind: 'error',
        message:
          err instanceof Error ? err.message : 'Tatizo la mtandao',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRevoke(token: AgentToken) {
    const ok = window.confirm(
      `Ondoa idhini ya wakala "${token.clientLabel ?? token.clientId}"? Hatua hii haiwezi kutenduliwa.\n\nRevoke agent "${token.clientLabel ?? token.clientId}"? This cannot be undone.`,
    );
    if (!ok) return;
    setRevoking(token.id);
    try {
      // The revoke endpoint needs the cleartext token. We don't store
      // cleartext on the client, so we POST a revoke-by-id request via
      // a server-trusted path. For now, surface a "use device to
      // revoke" hint until a per-id revoke endpoint lands.
      const res = await fetch(
        `${gatewayBaseUrl()}/api/v1/oauth/agent-tokens/${encodeURIComponent(token.id)}/revoke`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
        },
      );
      if (!res.ok && res.status !== 404) {
        const text = await res.text().catch(() => '');
        window.alert(
          `Tatizo: ${text || `HTTP ${res.status}`}. Jaribu tena. / Failed: ${text || `HTTP ${res.status}`}. Try again.`,
        );
        setRevoking(null);
        return;
      }
      await load();
    } catch (err) {
      window.alert(
        err instanceof Error
          ? err.message
          : 'Tatizo la mtandao / network error',
      );
    } finally {
      setRevoking(null);
    }
  }

  if (state.kind === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Inapakia mawakala / Loading agents"
        className="space-y-3"
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-md border border-border bg-surface/60"
          />
        ))}
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
      >
        <span>{state.message}</span>
        <button
          type="button"
          onClick={() => void load()}
          className="self-start rounded-md border border-destructive/40 bg-surface px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
        >
          Jaribu tena / Retry
        </button>
      </div>
    );
  }
  if (state.kind === 'empty') {
    return (
      <div className="rounded border border-border bg-surface p-6 text-sm">
        <p className="text-foreground">
          Hakuna wakala wa nje walioongezwa bado.
        </p>
        <p className="mt-1 italic text-neutral-400">
          No external agents are connected yet. When you authorize an
          agent via <code className="text-foreground">/oauth/confirm</code>,
          it will appear here.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {state.tokens.map((token) => (
        <li
          key={token.id}
          className="rounded border border-border bg-surface p-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="font-display text-lg text-foreground">
                {token.clientLabel || token.clientId}
              </div>
              <div className="text-xs font-mono text-neutral-400">
                client_id: {token.clientId}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {token.scopes.map((s) => (
                  <span
                    key={s}
                    className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-badge text-signal-500"
                  >
                    {s}
                  </span>
                ))}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-400">
                <dt>Iliongezwa / Issued</dt>
                <dd className="text-neutral-300">{formatRelative(token.issuedAt)}</dd>
                <dt>Imetumika mwisho / Last used</dt>
                <dd className="text-neutral-300">
                  {formatRelative(token.lastUsedAt)}
                </dd>
                {token.expiresAt && (
                  <>
                    <dt>Inaisha / Expires</dt>
                    <dd className="text-neutral-300">
                      {new Date(token.expiresAt).toLocaleString()}
                    </dd>
                  </>
                )}
              </dl>
            </div>
            <button
              type="button"
              onClick={() => handleRevoke(token)}
              disabled={revoking === token.id}
              className="rounded border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              {revoking === token.id ? 'Inaondoa…' : 'Ondoa / Revoke'}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
