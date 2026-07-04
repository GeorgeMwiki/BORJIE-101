'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Skeleton, ConfirmationModal } from '@borjie/design-system';
import { getCsrfHeaders } from '@/lib/csrf';
import { requirePublicBaseUrl } from '@/lib/env-guard';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { bcp47For } from '@/lib/format';
import { ApiError, localizeError } from '@/lib/api-client';
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

function formatRelative(input: string | null, locale: Locale): string {
  if (!input) return '—';
  const then = new Date(input).getTime();
  if (Number.isNaN(then)) return input;
  const diff = Date.now() - then;
  const min = Math.round(diff / 60_000);
  if (min < 1) {
    return pickByLocale(locale, S.connectedAgentsList.relNow);
  }
  if (min < 60) {
    return pickByLocale(locale, S.connectedAgentsList.relMinutesAgo).replace(
      '{n}',
      String(min),
    );
  }
  const hr = Math.round(min / 60);
  if (hr < 24) {
    return pickByLocale(locale, S.connectedAgentsList.relHoursAgo).replace(
      '{n}',
      String(hr),
    );
  }
  const day = Math.round(hr / 24);
  return pickByLocale(locale, S.connectedAgentsList.relDaysAgo).replace(
    '{n}',
    String(day),
  );
}

export function ConnectedAgentsList({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
}) {
  const locale = useLocale(initialLocale);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [revoking, setRevoking] = useState<string | null>(null);
  // The token pending a revoke-confirmation (replaces window.confirm with
  // the DS ConfirmationModal — focus-trapped, ESC-dismissable).
  const [pendingRevoke, setPendingRevoke] = useState<AgentToken | null>(null);
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
        // Localize by the stable gateway CODE — never the raw English envelope
        // `message` (rendering that under `sw` is language MIXING). The raw
        // message is kept only as the ApiError dev/Sentry field, never copy.
        const code =
          (json && 'error' in json && json.error?.code) || undefined;
        const devMessage =
          (json && 'error' in json && json.error?.message) ||
          `HTTP ${res.status}`;
        setState({
          kind: 'error',
          message: localizeError(
            new ApiError(devMessage, res.status, code),
            locale,
          ),
        });
        return;
      }
      const tokens = json.data;
      setState(tokens.length === 0 ? { kind: 'empty' } : { kind: 'ready', tokens });
    } catch (err) {
      // Localize the gateway error by its stable CODE — never the raw English
      // `.message` (rendering that under `sw` is language MIXING).
      setState({ kind: 'error', message: localizeError(err, locale) });
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  async function performRevoke(token: AgentToken) {
    setPendingRevoke(null);
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
        // NEVER render the raw gateway body (English) as toast copy — under
        // `sw` that is language MIXING. The failure reason is a fully-localized
        // status-only fragment; the raw body is discarded, never shown.
        const detail = pickByLocale(
          locale,
          S.connectedAgentsList.httpProblem,
        ).replace('{status}', String(res.status));
        setToastMsg(
          pickByLocale(locale, S.connectedAgentsList.revokeFailed).replace(
            '{detail}',
            detail,
          ),
        );
        setRevoking(null);
        return;
      }
      await load();
    } catch (err) {
      // Localize by stable CODE — never the raw English `.message` under `sw`.
      setToastMsg(localizeError(err, locale));
    } finally {
      setRevoking(null);
    }
  }

  if (state.kind === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={pickByLocale(locale, S.connectedAgentsList.loadingAria)}
        className="space-y-3"
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-md border border-border" />
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          className="self-start border-destructive/40 bg-surface text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive"
        >
          {pickByLocale(locale, S.connectedAgentsList.retry)}
        </Button>
      </div>
    );
  }
  if (state.kind === 'empty') {
    return (
      <div className="rounded border border-border bg-surface p-6 text-sm">
        <p className="text-foreground">
          {pickByLocale(locale, S.connectedAgentsList.emptyTitle)}
        </p>
        <p className="mt-1 italic text-muted-foreground">
          {pickByLocale(locale, S.connectedAgentsList.emptyBody)}{' '}
          <code className="text-foreground">/oauth/confirm</code>
          {pickByLocale(locale, S.connectedAgentsList.emptyBodySuffix)}
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
              <div className="text-xs font-mono text-muted-foreground">
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
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <dt>{pickByLocale(locale, S.connectedAgentsList.issued)}</dt>
                <dd className="text-muted-foreground">
                  {formatRelative(token.issuedAt, locale)}
                </dd>
                <dt>{pickByLocale(locale, S.connectedAgentsList.lastUsed)}</dt>
                <dd className="text-muted-foreground">
                  {formatRelative(token.lastUsedAt, locale)}
                </dd>
                {token.expiresAt && (
                  <>
                    <dt>{pickByLocale(locale, S.connectedAgentsList.expires)}</dt>
                    <dd className="text-muted-foreground">
                      {new Date(token.expiresAt).toLocaleString(bcp47For(locale))}
                    </dd>
                  </>
                )}
              </dl>
            </div>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setPendingRevoke(token)}
              loading={revoking === token.id}
            >
              {revoking === token.id
                ? pickByLocale(locale, S.connectedAgentsList.revoking)
                : pickByLocale(locale, S.connectedAgentsList.revoke)}
            </Button>
          </div>
        </li>
      ))}
    </ul>
    <ConfirmationModal
      open={pendingRevoke !== null}
      onClose={() => setPendingRevoke(null)}
      onConfirm={() => {
        if (pendingRevoke) void performRevoke(pendingRevoke);
      }}
      variant="danger"
      title={pickByLocale(locale, S.connectedAgentsList.revokeTitle)}
      {...(pendingRevoke
        ? {
            description: pickByLocale(locale, S.connectedAgentsList.revokeConfirm).replace(
              '{label}',
              pendingRevoke.clientLabel ?? pendingRevoke.clientId,
            ),
          }
        : {})}
      confirmLabel={pickByLocale(locale, S.connectedAgentsList.revoke)}
      cancelLabel={pickByLocale(locale, S.connectedAgentsList.cancel)}
    />
    {toastMsg ? (
      <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />
    ) : null}
    </>
  );
}
