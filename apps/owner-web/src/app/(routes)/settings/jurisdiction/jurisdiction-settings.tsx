'use client';

import { useCallback, useEffect, useState } from 'react';
import { requirePublicBaseUrl } from '@/lib/env-guard';
import { routesBStrings as S } from '@/i18n/strings/routes-b';
import { useLocale, pickByLocale } from '@/lib/locale';

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
  const locale = useLocale();
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
        {pickByLocale(locale, S.jurisdictionSettings.loading)}
      </p>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/10 p-4">
        <p className="text-sm text-red-200">
          {pickByLocale(locale, {
            en: `Could not load jurisdiction. ${state.message}`,
            sw: `Imeshindwa kupakia eneo la sheria. ${state.message}`,
          })}
        </p>
        <button
          type="button"
          onClick={load}
          className="mt-2 rounded border border-red-300/40 px-3 py-1 text-xs text-red-100 hover:bg-red-500/20"
        >
          {pickByLocale(locale, { en: 'Retry', sw: S.connectedAgentsList.retry.sw })}
        </button>
      </div>
    );
  }

  const snap = state.snapshot;
  return (
    <div className="space-y-6">
      <CurrentJurisdictionCard snapshot={snap} locale={locale} />
      <LockedNoticeCard snapshot={snap} locale={locale} />
      <PerTurnOverrideCard snapshot={snap} locale={locale} />
    </div>
  );
}

function CurrentJurisdictionCard({
  snapshot,
  locale,
}: {
  snapshot: JurisdictionSnapshot;
  locale: ReturnType<typeof useLocale>;
}) {
  return (
    <section className="rounded-md border border-border bg-surface p-5">
      <h2 className="font-display text-xl text-foreground">
        {pickByLocale(locale, { en: 'Current jurisdiction', sw: 'Eneo la sasa la sheria' })}
      </h2>
      <p className="mt-0.5 text-xs italic text-neutral-500">
        {pickByLocale(locale, S.jurisdictionSettings.currentTagline)}
      </p>
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label={pickByLocale(locale, S.jurisdictionSettings.fieldCountry)}
          value={`${snapshot.countryName} (${snapshot.country})`}
        />
        <Field
          label={pickByLocale(locale, S.jurisdictionSettings.fieldCurrency)}
          value={snapshot.currency}
        />
        <Field
          label={pickByLocale(locale, S.jurisdictionSettings.fieldDefaultLanguage)}
          value={`${snapshot.defaultLanguage} (${snapshot.locale})`}
        />
        <Field
          label={pickByLocale(locale, S.jurisdictionSettings.fieldTimeZone)}
          value={snapshot.timeZone}
        />
        <Field
          label={pickByLocale(locale, S.jurisdictionSettings.fieldMineralAuthority)}
          value={snapshot.regulators.mineral}
        />
        <Field
          label={pickByLocale(locale, S.jurisdictionSettings.fieldEnvironmentalAuthority)}
          value={snapshot.regulators.environmental}
        />
        <Field
          label={pickByLocale(locale, S.jurisdictionSettings.fieldTransparency)}
          value={snapshot.regulators.transparency}
        />
        <Field
          label={pickByLocale(locale, S.jurisdictionSettings.fieldAuditAuthority)}
          value={snapshot.regulators.audit}
        />
      </dl>
    </section>
  );
}

function LockedNoticeCard({
  snapshot,
  locale,
}: {
  snapshot: JurisdictionSnapshot;
  locale: ReturnType<typeof useLocale>;
}) {
  return (
    <section className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-5">
      <h2 className="font-display text-lg text-yellow-200">
        {pickByLocale(locale, {
          en: 'Jurisdiction is locked',
          sw: 'Eneo la sheria limefungwa',
        })}
      </h2>
      <p className="mt-0.5 text-xs italic text-yellow-200/60">
        {pickByLocale(locale, S.jurisdictionSettings.lockedTagline)}
      </p>
      <p className="mt-3 text-sm text-yellow-100/80">
        {pickByLocale(locale, {
          en: (
            <>
              Your tenant is locked to <strong>{snapshot.country}</strong>{' '}
              ({snapshot.countryName}) for compliance. Permanent jurisdiction
              changes touch every saved licence, royalty, and audit chain, so
              only Borjie support can apply them after a verification call.
            </>
          ),
          sw: (
            <>
              {S.jurisdictionSettings.lockedBodySwPrefix.sw}{' '}
              <strong>{snapshot.country}</strong>{' '}
              {S.jurisdictionSettings.lockedBodySwSuffix.sw}
            </>
          ),
        })}
      </p>
      <a
        href="mailto:support@borjie.app?subject=Jurisdiction%20change%20request"
        className="mt-4 inline-flex items-center rounded border border-yellow-300/40 px-3 py-1.5 text-xs text-yellow-100 hover:bg-yellow-500/10"
      >
        {pickByLocale(locale, S.jurisdictionSettings.requestChange)}
      </a>
    </section>
  );
}

function PerTurnOverrideCard({
  snapshot,
  locale,
}: {
  snapshot: JurisdictionSnapshot;
  locale: ReturnType<typeof useLocale>;
}) {
  void snapshot;
  return (
    <section className="rounded-md border border-border bg-surface p-5">
      <h2 className="font-display text-lg text-foreground">
        {pickByLocale(locale, {
          en: 'Ask about another jurisdiction',
          sw: 'Uliza kuhusu eneo lingine la sheria',
        })}
      </h2>
      <p className="mt-0.5 text-xs italic text-neutral-500">
        {pickByLocale(locale, S.jurisdictionSettings.overrideTagline)}
      </p>
      <p className="mt-3 text-sm text-neutral-300">
        {pickByLocale(locale, {
          en: (
            <>
              You can ask Mr. Mwikila for a one-turn answer in any other
              jurisdiction we know — just say{' '}
              <em>&quot;in Kenya, ...&quot;</em> or{' '}
              <em>&quot;for our Uganda operation, ...&quot;</em>. The chat
              switches context for that turn and resets back to your locked
              jurisdiction on the next message.
            </>
          ),
          sw: (
            <>
              {S.jurisdictionSettings.overrideBodySw.sw}{' '}
              <em>&quot;in Kenya, ...&quot;</em>{' '}
              {S.jurisdictionSettings.overrideBodySwOr.sw}{' '}
              <em>&quot;for our Uganda operation, ...&quot;</em>.
            </>
          ),
        })}
      </p>
      <p className="mt-3 text-xs text-neutral-500">
        {pickByLocale(locale, {
          en: 'Seeded jurisdictions: TZ, KE, UG, NG, ZA, AU, CL, ID. Anything else routes through the on-demand jurisdiction discovery service — Mr. Mwikila will research the regulators live, cite his sources, and offer to seed the jurisdiction permanently (requires a Borjie internal admin approval).',
          sw: 'Maeneo yaliyopandwa: TZ, KE, UG, NG, ZA, AU, CL, ID. Mengine yanaelekezwa kupitia huduma ya ugunduzi wa eneo la sheria — Bw. Mwikila atachunguza wadhibiti moja kwa moja, atataja vyanzo vyake, na atatoa kupanda eneo kwa kudumu (inahitaji idhini ya msimamizi wa ndani wa Borjie).',
        })}
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
