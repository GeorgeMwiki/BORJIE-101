'use client';

import { useCallback, useEffect, useState } from 'react';
import { requirePublicBaseUrl } from '@/lib/env-guard';

type Regulators = {
  readonly mineral: string;
  readonly environmental: string;
  readonly transparency: string;
  readonly audit: string;
};

type JurisdictionSnapshot = {
  readonly country: string;
  readonly countryName: string;
  readonly currency: string;
  readonly defaultLanguage: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly regulators: Regulators;
  readonly source: 'tenant' | 'override' | 'unseeded';
  readonly locked: boolean;
};

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: JurisdictionSnapshot }
  | { kind: 'error'; message: string };

function gatewayBaseUrl(): string {
  return requirePublicBaseUrl(
    'NEXT_PUBLIC_API_GATEWAY_URL',
    'http://localhost:4001',
  ).replace(/\/$/, '');
}

/**
 * Live-data client component. Calls GET /api/v1/me/jurisdiction
 * (JA-7 endpoint) and renders the resolved snapshot.
 */
export function JurisdictionSettings() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await fetch(`${gatewayBaseUrl()}/api/v1/me/jurisdiction`, {
        credentials: 'include',
      });
      const json = (await res.json().catch(() => null)) as
        | { success: true; data: JurisdictionSnapshot }
        | { success?: false; error?: { code: string; message: string } }
        | null;
      if (!res.ok || !json || !('success' in json) || !json.success) {
        const message =
          (json && 'error' in json && json.error?.message) ||
          `HTTP ${res.status}`;
        setState({ kind: 'error', message });
        return;
      }
      setState({ kind: 'ready', snapshot: json.data });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === 'loading') {
    return (
      <p className="text-sm text-neutral-400">
        Loading jurisdiction snapshot… / Inapakia muktadha…
      </p>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/10 p-4">
        <p className="text-sm text-red-200">
          Could not load jurisdiction. {state.message}
        </p>
        <button
          type="button"
          onClick={load}
          className="mt-2 rounded border border-red-300/40 px-3 py-1 text-xs text-red-100 hover:bg-red-500/20"
        >
          Retry
        </button>
      </div>
    );
  }

  const snap = state.snapshot;
  return (
    <div className="space-y-6">
      <CurrentJurisdictionCard snapshot={snap} />
      <LockedNoticeCard snapshot={snap} />
      <PerTurnOverrideCard snapshot={snap} />
    </div>
  );
}

function CurrentJurisdictionCard({
  snapshot,
}: {
  snapshot: JurisdictionSnapshot;
}) {
  return (
    <section className="rounded-md border border-border bg-surface p-5">
      <h2 className="font-display text-xl text-foreground">
        Current jurisdiction
      </h2>
      <p className="mt-0.5 text-xs italic text-neutral-500">
        Eneo la sasa la sheria
      </p>
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Country / Nchi"
          value={`${snapshot.countryName} (${snapshot.country})`}
        />
        <Field
          label="Currency / Sarafu"
          value={snapshot.currency}
        />
        <Field
          label="Default language / Lugha"
          value={`${snapshot.defaultLanguage} (${snapshot.locale})`}
        />
        <Field
          label="Time zone / Eneo la saa"
          value={snapshot.timeZone}
        />
        <Field
          label="Mineral authority / Mdhibiti wa madini"
          value={snapshot.regulators.mineral}
        />
        <Field
          label="Environmental authority / Mdhibiti wa mazingira"
          value={snapshot.regulators.environmental}
        />
        <Field
          label="Transparency initiative / Uwazi"
          value={snapshot.regulators.transparency}
        />
        <Field
          label="Audit authority / Mkaguzi"
          value={snapshot.regulators.audit}
        />
      </dl>
    </section>
  );
}

function LockedNoticeCard({
  snapshot,
}: {
  snapshot: JurisdictionSnapshot;
}) {
  return (
    <section className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-5">
      <h2 className="font-display text-lg text-yellow-200">
        Jurisdiction is locked
      </h2>
      <p className="mt-0.5 text-xs italic text-yellow-200/60">
        Eneo la sheria limefungwa
      </p>
      <p className="mt-3 text-sm text-yellow-100/80">
        Your tenant is locked to <strong>{snapshot.country}</strong>{' '}
        ({snapshot.countryName}) for compliance. Permanent jurisdiction
        changes touch every saved licence, royalty, and audit chain, so
        only Borjie support can apply them after a verification call.
      </p>
      <p className="mt-2 text-sm italic text-yellow-100/60">
        Akaunti yako imefungwa kwa <strong>{snapshot.country}</strong>{' '}
        kwa ajili ya utiifu. Mabadiliko ya kudumu yanahitaji msaada wa
        Borjie baada ya simu ya uthibitisho.
      </p>
      <a
        href="mailto:support@borjie.app?subject=Jurisdiction%20change%20request"
        className="mt-4 inline-flex items-center rounded border border-yellow-300/40 px-3 py-1.5 text-xs text-yellow-100 hover:bg-yellow-500/10"
      >
        Request a change / Omba mabadiliko
      </a>
    </section>
  );
}

function PerTurnOverrideCard({
  snapshot,
}: {
  snapshot: JurisdictionSnapshot;
}) {
  void snapshot;
  return (
    <section className="rounded-md border border-border bg-surface p-5">
      <h2 className="font-display text-lg text-foreground">
        Ask about another jurisdiction
      </h2>
      <p className="mt-0.5 text-xs italic text-neutral-500">
        Uliza kuhusu eneo lingine la sheria
      </p>
      <p className="mt-3 text-sm text-neutral-300">
        You can ask Mr. Mwikila for a one-turn answer in any other
        jurisdiction we know — just say{' '}
        <em>&quot;in Kenya, ...&quot;</em> or{' '}
        <em>&quot;for our Uganda operation, ...&quot;</em>. The chat
        switches context for that turn and resets back to your locked
        jurisdiction on the next message.
      </p>
      <p className="mt-2 text-sm italic text-neutral-400">
        Unaweza kuomba jibu la zamu moja kwa eneo lingine — sema kwa
        mfano <em>&quot;in Kenya, ...&quot;</em> au{' '}
        <em>&quot;for our Uganda operation, ...&quot;</em>.
      </p>
      <p className="mt-3 text-xs text-neutral-500">
        Seeded jurisdictions: TZ, KE, UG, NG, ZA, AU, CL, ID. Anything
        else routes through the on-demand jurisdiction discovery service
        — Mr. Mwikila will research the regulators live, cite his
        sources, and offer to seed the jurisdiction permanently (requires
        a Borjie internal admin approval).
      </p>
    </section>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
    </div>
  );
}
