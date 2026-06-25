'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getCsrfHeaders } from '@/lib/csrf';
import { requirePublicBaseUrl } from '@/lib/env-guard';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { localizeError } from '@/lib/api-client';
import { routesBStrings as S } from '@/i18n/strings/routes-b';
import { Button } from '@borjie/design-system';

type DeviceDetails = {
  readonly client_id: string;
  readonly client_label: string;
  readonly scopes: readonly string[];
  readonly status: 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';
  readonly expires_at: string;
};

type Phase =
  | { kind: 'loading' }
  | { kind: 'missing-code' }
  | { kind: 'ready'; details: DeviceDetails }
  | { kind: 'approving' }
  | { kind: 'denying' }
  | { kind: 'approved'; countdown: number }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

function gatewayBaseUrl(): string {
  // Production builds throw via requirePublicBaseUrl if the env var is
  // missing — avoids silent localhost fetches in deployed cockpit.
  return requirePublicBaseUrl(
    'NEXT_PUBLIC_API_GATEWAY_URL',
    'http://localhost:4001',
  ).replace(/\/$/, '');
}

const SCOPE_LABELS: Readonly<Record<string, { sw: string; en: string }>> = {
  'owner:read': S.oauthConfirm.scopeOwnerRead,
  'owner:write': S.oauthConfirm.scopeOwnerWrite,
  'owner:draft': S.oauthConfirm.scopeOwnerDraft,
  'owner:reminders': S.oauthConfirm.scopeOwnerReminders,
  'owner:share': S.oauthConfirm.scopeOwnerShare,
  'admin:read': S.oauthConfirm.scopeAdminRead,
};

/** Resolve a scope's display label in the active locale, falling back to the raw id. */
function scopeLabel(scope: string, locale: Locale): string {
  const entry = SCOPE_LABELS[scope];
  return entry ? pickByLocale(locale, entry) : scope;
}

export function OAuthConfirmPanel({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}) {
  const router = useRouter();
  const params = useSearchParams();
  const locale = useLocale(initialLocale);
  const userCode = params.get('code') ?? '';

  const [phase, setPhase] = useState<Phase>(
    userCode.length > 0 ? { kind: 'loading' } : { kind: 'missing-code' },
  );

  useEffect(() => {
    if (userCode.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${gatewayBaseUrl()}/api/v1/oauth/device/details?code=${encodeURIComponent(userCode)}`,
          { credentials: 'include' },
        );
        const json = (await res.json().catch(() => null)) as
          | DeviceDetails
          | { error: string; error_description?: string }
          | null;
        if (cancelled) return;
        if (!res.ok || !json || 'error' in json) {
          const message =
            (json && 'error_description' in json && json.error_description) ||
            (json && 'error' in json && json.error) ||
            pickByLocale(locale, S.oauthConfirm.commProblem).replace(
              '{status}',
              String(res.status),
            );
          setPhase({ kind: 'error', message });
          return;
        }
        setPhase({ kind: 'ready', details: json });
      } catch (err) {
        if (cancelled) return;
        // Localize by stable CODE — never the raw English `.message` under
        // `sw` (language MIXING).
        setPhase({ kind: 'error', message: localizeError(err, locale) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userCode, locale]);

  useEffect(() => {
    if (phase.kind !== 'approved') return;
    const t = setInterval(() => {
      setPhase((prev) =>
        prev.kind === 'approved'
          ? { kind: 'approved', countdown: prev.countdown - 1 }
          : prev,
      );
    }, 1000);
    return () => clearInterval(t);
  }, [phase.kind]);

  useEffect(() => {
    if (phase.kind === 'approved' && phase.countdown <= 0) {
      router.push('/settings/connected-agents');
    }
  }, [phase, router]);

  async function handleApprove() {
    if (phase.kind !== 'ready') return;
    setPhase({ kind: 'approving' });
    try {
      const res = await fetch(
        `${gatewayBaseUrl()}/api/v1/oauth/device/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
          credentials: 'include',
          body: JSON.stringify({ user_code: userCode }),
        },
      );
      const json = (await res.json().catch(() => null)) as
        | { success: true; approved: true }
        | { error: string; error_description?: string }
        | null;
      if (!res.ok || !json || 'error' in json) {
        if (res.status === 401) {
          router.push(
            `/sign-in?next=${encodeURIComponent(`/oauth/confirm?code=${userCode}`)}`,
          );
          return;
        }
        const message =
          (json && 'error_description' in json && json.error_description) ||
          (json && 'error' in json && json.error) ||
          pickByLocale(locale, S.oauthConfirm.httpProblem).replace(
            '{status}',
            String(res.status),
          );
        setPhase({ kind: 'error', message });
        return;
      }
      setPhase({ kind: 'approved', countdown: 5 });
    } catch (err) {
      // Localize by stable CODE — never the raw English `.message` under `sw`.
      setPhase({ kind: 'error', message: localizeError(err, locale) });
    }
  }

  async function handleDeny() {
    if (phase.kind !== 'ready') return;
    setPhase({ kind: 'denying' });
    try {
      const res = await fetch(
        `${gatewayBaseUrl()}/api/v1/oauth/device/deny`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
          credentials: 'include',
          body: JSON.stringify({ user_code: userCode }),
        },
      );
      if (!res.ok) {
        if (res.status === 401) {
          router.push(
            `/sign-in?next=${encodeURIComponent(`/oauth/confirm?code=${userCode}`)}`,
          );
          return;
        }
      }
      setPhase({ kind: 'denied' });
    } catch (err) {
      // Localize by stable CODE — never the raw English `.message` under `sw`.
      setPhase({ kind: 'error', message: localizeError(err, locale) });
    }
  }

  return (
    <div className="w-full max-w-xl rounded-lg border border-border bg-surface p-8">
      <header className="mb-6">
        <div className="text-xs font-mono text-neutral-500">OAUTH-DEVICE-CONFIRM</div>
        <h1 className="mt-1 font-display text-2xl text-foreground">
          {pickByLocale(locale, S.oauthConfirm.header)}
        </h1>
      </header>

      {phase.kind === 'missing-code' && (
        <p className="text-sm text-destructive">
          {pickByLocale(locale, S.oauthConfirm.missingCode)}
        </p>
      )}

      {phase.kind === 'loading' && (
        <div
          role="status"
          aria-live="polite"
          aria-label={pickByLocale(locale, S.oauthConfirm.loadingAria)}
          className="space-y-3"
        >
          <div className="h-6 w-2/3 animate-pulse rounded bg-surface-raised" />
          <div className="h-24 animate-pulse rounded-lg border border-border bg-surface/60" />
          <div className="h-10 w-1/2 animate-pulse rounded bg-surface-raised" />
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="rounded border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {phase.message}
        </div>
      )}

      {(phase.kind === 'ready' || phase.kind === 'approving' || phase.kind === 'denying') && (
        <ConsentBody
          details={
            phase.kind === 'ready'
              ? phase.details
              : ({} as DeviceDetails)
          }
          userCode={userCode}
          busy={phase.kind !== 'ready'}
          locale={locale}
          onApprove={handleApprove}
          onDeny={handleDeny}
        />
      )}

      {phase.kind === 'approved' && (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
          <p className="text-foreground">
            {pickByLocale(locale, S.oauthConfirm.approvedTitle)}
          </p>
          <p className="mt-1 italic text-neutral-400">
            {pickByLocale(locale, S.oauthConfirm.approvedBody)}
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            {pickByLocale(locale, S.oauthConfirm.approvedRedirect).replace(
              '{n}',
              String(Math.max(0, phase.countdown)),
            )}
          </p>
        </div>
      )}

      {phase.kind === 'denied' && (
        <div className="rounded border border-border bg-background p-4 text-sm">
          <p className="text-foreground">
            {pickByLocale(locale, S.oauthConfirm.deniedTitle)}
          </p>
          <p className="mt-1 italic text-neutral-400">
            {pickByLocale(locale, S.oauthConfirm.deniedBody)}
          </p>
        </div>
      )}
    </div>
  );
}

function ConsentBody(props: {
  readonly details: DeviceDetails;
  readonly userCode: string;
  readonly busy: boolean;
  readonly locale: Locale;
  readonly onApprove: () => void;
  readonly onDeny: () => void;
}) {
  const { details, userCode, busy, locale, onApprove, onDeny } = props;
  const scopes = details.scopes ?? [];
  return (
    <div className="space-y-5">
      <section className="rounded border border-border bg-background p-4">
        <div className="text-xs text-neutral-500">
          {pickByLocale(locale, S.oauthConfirm.agentLabel)}
        </div>
        <div className="mt-0.5 font-display text-lg text-foreground">
          {details.client_label || details.client_id || 'Agent'}
        </div>
        <div className="mt-0.5 text-xs font-mono text-neutral-400">
          client_id: {details.client_id}
        </div>
        <div className="mt-2 text-xs text-neutral-500">
          {pickByLocale(locale, S.oauthConfirm.codeLabel)}:{' '}
          <span className="font-mono text-foreground">{userCode}</span>
        </div>
      </section>

      <section>
        <div className="text-xs text-neutral-500">
          {pickByLocale(locale, S.oauthConfirm.requestsPermissions)}
        </div>
        <ul className="mt-2 space-y-2">
          {scopes.length === 0 && (
            <li className="text-sm text-neutral-400">
              {pickByLocale(locale, S.oauthConfirm.noScopes)}
            </li>
          )}
          {scopes.map((s) => (
            <li
              key={s}
              className="rounded border border-border bg-background p-3 text-sm"
            >
              <div className="font-mono text-xs text-signal-500">{s}</div>
              <div className="mt-0.5 text-foreground">
                {scopeLabel(s, locale)}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-neutral-500">
        {pickByLocale(locale, S.oauthConfirm.revokeNotePrefix)}{' '}
        <code className="text-foreground">/settings/connected-agents</code>{' '}
        {pickByLocale(locale, S.oauthConfirm.revokeNoteSuffix)}
      </p>

      <div className="flex gap-3">
        <Button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="flex-1"
        >
          {pickByLocale(locale, S.oauthConfirm.approve)}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onDeny}
          disabled={busy}
          className="flex-1"
        >
          {pickByLocale(locale, S.oauthConfirm.deny)}
        </Button>
      </div>
    </div>
  );
}
