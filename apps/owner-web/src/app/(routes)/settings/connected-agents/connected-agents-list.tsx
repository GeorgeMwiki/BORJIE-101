'use client';

import { useCallback, useEffect, useState } from 'react';
import { getCsrfHeaders } from '@/lib/csrf';
import { requirePublicBaseUrl } from '@/lib/env-guard';
import { routesBStrings as S } from '@/i18n/strings/routes-b';
import { Toast } from '@/components/shared/Toast';

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

function bilingual(sw: string, en: string): string {
  return `${sw} / ${en}`;
}

function formatRelative(input: string | null): string {
  if (!input) return '—';
  const then = new Date(input).getTime();
  if (Number.isNaN(then)) return input;
  const diff = Date.now() - then;
  const min = Math.round(diff / 60_000);
  if (min < 1) {
    return bilingual(S.connectedAgentsList.relNow.sw, S.connectedAgentsList.relNow.en);
  }
  if (min < 60) {
    return bilingual(
      S.connectedAgentsList.relMinutesAgo.sw.replace('{n}', String(min)),
      S.connectedAgentsList.relMinutesAgo.en.replace('{n}', String(min)),
    );
  }
  const hr = Math.round(min / 60);
  if (hr < 24) {
    return bilingual(
      S.connectedAgentsList.relHoursAgo.sw.replace('{n}', String(hr)),
      S.connectedAgentsList.relHoursAgo.en.replace('{n}', String(hr)),
    );
  }
  const day = Math.round(hr / 24);
  return bilingual(
    S.connectedAgentsList.relDaysAgo.sw.replace('{n}', String(day)),
    S.connectedAgentsList.relDaysAgo.en.replace('{n}', String(day)),
  );
}

export function ConnectedAgentsList() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [revoking, setRevoking] = useState<string | null>(null);
  // In-app toast for revoke failures (replaces window.alert).
  const [toastMsg, setToastMsg] = useState<string | null>(null);

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
          S.connectedAgentsList.httpProblem.sw.replace(
            '{status}',
            String(res.status),
          );
        setState({ kind: 'error', message });
        return;
      }
      const tokens = json.data;
      setState(tokens.length === 0 ? { kind: 'empty' } : { kind: 'ready', tokens });
    } catch (err) {
      setState({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : S.connectedAgentsList.networkError.sw,
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRevoke(token: AgentToken) {
    const label = token.clientLabel ?? token.clientId;
    const swConfirm = S.connectedAgentsList.revokeConfirm.sw.replace(
      '{label}',
      label,
    );
    const enConfirm = S.connectedAgentsList.revokeConfirm.en.replace(
      '{label}',
      label,
    );
    const ok = window.confirm(`${swConfirm}\n\n${enConfirm}`);
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
        const detail = text || `HTTP ${res.status}`;
        const swFail = S.connectedAgentsList.revokeFailed.sw.replace(
          '{detail}',
          detail,
        );
        const enFail = S.connectedAgentsList.revokeFailed.en.replace(
          '{detail}',
          detail,
        );
        setToastMsg(`${swFail} / ${enFail}`);
        setRevoking(null);
        return;
      }
      await load();
    } catch (err) {
      setToastMsg(
        err instanceof Error
          ? err.message
          : bilingual(
              S.connectedAgentsList.networkError.sw,
              S.connectedAgentsList.networkError.en,
            ),
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
        aria-label={`${S.connectedAgentsList.loadingAria.sw} / ${S.connectedAgentsList.loadingAria.en}`}
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
          {`${S.connectedAgentsList.retry.sw} / ${S.connectedAgentsList.retry.en}`}
        </button>
      </div>
    );
  }
  if (state.kind === 'empty') {
    return (
      <div className="rounded border border-border bg-surface p-6 text-sm">
        <p className="text-foreground">
          {S.connectedAgentsList.emptyTitle.sw}
        </p>
        <p className="mt-1 italic text-neutral-400">
          {S.connectedAgentsList.emptyBody.en}{' '}
          <code className="text-foreground">/oauth/confirm</code>, it will
          appear here.
        </p>
      </div>
    );
  }
  return (
    <>
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
                <dt>{`${S.connectedAgentsList.issued.sw} / ${S.connectedAgentsList.issued.en}`}</dt>
                <dd className="text-neutral-300">{formatRelative(token.issuedAt)}</dd>
                <dt>{`${S.connectedAgentsList.lastUsed.sw} / ${S.connectedAgentsList.lastUsed.en}`}</dt>
                <dd className="text-neutral-300">
                  {formatRelative(token.lastUsedAt)}
                </dd>
                {token.expiresAt && (
                  <>
                    <dt>{`${S.connectedAgentsList.expires.sw} / ${S.connectedAgentsList.expires.en}`}</dt>
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
              {revoking === token.id
                ? S.connectedAgentsList.revoking.sw
                : `${S.connectedAgentsList.revoke.sw} / ${S.connectedAgentsList.revoke.en}`}
            </button>
          </div>
        </li>
      ))}
    </ul>
    {toastMsg ? (
      <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />
    ) : null}
    </>
  );
}
