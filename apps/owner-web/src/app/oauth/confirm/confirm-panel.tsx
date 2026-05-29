'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getCsrfHeaders } from '@/lib/csrf';
import { requirePublicBaseUrl } from '@/lib/env-guard';

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

const SCOPE_LABELS_EN: Readonly<Record<string, string>> = {
  'owner:read':
    'Read cockpit data (drafts, reminders, decisions, entities)',
  'owner:write': 'Create or update owner data (excluding money)',
  'owner:draft': 'Create, edit, and lock document drafts',
  'owner:reminders': 'Schedule reminders for you',
  'owner:share': 'Generate share links to your data',
  'admin:read': 'Read internal admin data (Borjie team only)',
};

const SCOPE_LABELS_SW: Readonly<Record<string, string>> = {
  'owner:read':
    'Soma data ya cockpit (rasimu, vikumbusho, maamuzi, vitu)',
  'owner:write':
    'Tengeneza au sasisha data ya mmiliki (bila kuhusisha pesa)',
  'owner:draft': 'Tengeneza, hariri, na funga rasimu za nyaraka',
  'owner:reminders': 'Panga vikumbusho kwa ajili yako',
  'owner:share':
    'Tengeneza viungo vya kushiriki data yako',
  'admin:read':
    'Soma data ya msimamizi wa ndani (Borjie team only)',
};

export function OAuthConfirmPanel() {
  const router = useRouter();
  const params = useSearchParams();
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
            `Tatizo la mawasiliano (HTTP ${res.status})`;
          setPhase({ kind: 'error', message });
          return;
        }
        setPhase({ kind: 'ready', details: json });
      } catch (err) {
        if (cancelled) return;
        setPhase({
          kind: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'Tatizo la mtandao — jaribu tena',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userCode]);

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
          `Tatizo (HTTP ${res.status})`;
        setPhase({ kind: 'error', message });
        return;
      }
      setPhase({ kind: 'approved', countdown: 5 });
    } catch (err) {
      setPhase({
        kind: 'error',
        message:
          err instanceof Error ? err.message : 'Tatizo la mtandao',
      });
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
      setPhase({
        kind: 'error',
        message:
          err instanceof Error ? err.message : 'Tatizo la mtandao',
      });
    }
  }

  return (
    <div className="w-full max-w-xl rounded-lg border border-border bg-surface p-8">
      <header className="mb-6">
        <div className="text-xs font-mono text-neutral-500">OAUTH-DEVICE-CONFIRM</div>
        <h1 className="mt-1 font-display text-2xl text-foreground">
          Authorize external agent
        </h1>
        <p className="mt-0.5 text-sm italic text-neutral-500">
          Idhinisha wakala wa nje
        </p>
      </header>

      {phase.kind === 'missing-code' && (
        <p className="text-sm text-destructive">
          Hakuna msimbo wa mtumiaji. Hakikisha umetumia kiunganisho
          alichokupa wakala. (No user code provided — make sure you used
          the link the agent gave you.)
        </p>
      )}

      {phase.kind === 'loading' && (
        <div
          role="status"
          aria-live="polite"
          aria-label="Inapakia maelezo ya wakala / Loading agent details"
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
          onApprove={handleApprove}
          onDeny={handleDeny}
        />
      )}

      {phase.kind === 'approved' && (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
          <p className="text-foreground">
            Imeidhinishwa. Wakala anaweza kufanya kazi sasa.
          </p>
          <p className="mt-1 italic text-neutral-400">
            Approved. The agent can now act on your behalf.
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            Inaelekeza kwenye orodha ya wakala katika sekunde {Math.max(0, phase.countdown)} …
          </p>
        </div>
      )}

      {phase.kind === 'denied' && (
        <div className="rounded border border-border bg-background p-4 text-sm">
          <p className="text-foreground">Umekataa ombi.</p>
          <p className="mt-1 italic text-neutral-400">
            You denied the request. The device will not receive a token.
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
  readonly onApprove: () => void;
  readonly onDeny: () => void;
}) {
  const { details, userCode, busy, onApprove, onDeny } = props;
  const scopes = details.scopes ?? [];
  return (
    <div className="space-y-5">
      <section className="rounded border border-border bg-background p-4">
        <div className="text-xs text-neutral-500">Wakala / Agent</div>
        <div className="mt-0.5 font-display text-lg text-foreground">
          {details.client_label || details.client_id || 'Agent'}
        </div>
        <div className="mt-0.5 text-xs font-mono text-neutral-400">
          client_id: {details.client_id}
        </div>
        <div className="mt-2 text-xs text-neutral-500">
          Msimbo / Code:{' '}
          <span className="font-mono text-foreground">{userCode}</span>
        </div>
      </section>

      <section>
        <div className="text-xs text-neutral-500">
          Anaomba ruhusa zifuatazo / Requests the following permissions
        </div>
        <ul className="mt-2 space-y-2">
          {scopes.length === 0 && (
            <li className="text-sm text-neutral-400">
              Hakuna ruhusa maalum (no specific scopes requested)
            </li>
          )}
          {scopes.map((s) => (
            <li
              key={s}
              className="rounded border border-border bg-background p-3 text-sm"
            >
              <div className="font-mono text-xs text-signal-500">{s}</div>
              <div className="mt-0.5 text-foreground">
                {SCOPE_LABELS_EN[s] ?? s}
              </div>
              <div className="mt-0.5 text-xs italic text-neutral-500">
                {SCOPE_LABELS_SW[s] ?? s}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-neutral-500">
        Unaweza kuondoa idhini wakati wowote kutoka{' '}
        <code className="text-foreground">/settings/connected-agents</code>.
        You can revoke this at any time from Settings → Connected agents.
      </p>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="flex-1 rounded bg-signal-500 px-4 py-2 text-sm font-semibold text-background hover:bg-signal-400 disabled:opacity-50"
        >
          Idhinisha / Approve
        </button>
        <button
          type="button"
          onClick={onDeny}
          disabled={busy}
          className="flex-1 rounded border border-border bg-background px-4 py-2 text-sm text-foreground hover:bg-surface disabled:opacity-50"
        >
          Kataa / Deny
        </button>
      </div>
    </div>
  );
}
