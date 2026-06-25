'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Skeleton, Alert } from '@borjie/design-system';
import { requirePublicBaseUrl } from '@/lib/env-guard';
import { routesBStrings as S } from '@/i18n/strings/routes-b';
import { jurisdictionSettingsStrings as JS } from '@/i18n/strings/jurisdiction-settings';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { ApiError, localizeError } from '@/lib/api-client';

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
export function JurisdictionSettings({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
}) {
  const locale = useLocale(initialLocale);
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
        // Localize by the stable gateway CODE — never the raw English
        // envelope `message` (rendering that under `sw` is language MIXING).
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
      setState({ kind: 'ready', snapshot: json.data });
    } catch (err) {
      // Localize the network/parse error too (no raw English under `sw`).
      setState({ kind: 'error', message: localizeError(err, locale) });
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === 'loading') {
    return (
      <div
        role="status"
        aria-label={pickByLocale(locale, S.jurisdictionSettings.loading)}
        className="space-y-4"
      >
        <Skeleton className="h-40 rounded-lg border border-border" />
        <Skeleton className="h-28 rounded-lg border border-border" />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <Alert variant="error">
        <p className="text-sm">
          {pickByLocale(locale, JS.loadError(state.message))}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={load}
          className="mt-2"
        >
          {pickByLocale(locale, S.connectedAgentsList.retry)}
        </Button>
      </Alert>
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
        {pickByLocale(locale, JS.currentHeading)}
      </h2>
      <p className="mt-0.5 text-xs italic text-muted-foreground">
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
    <section className="rounded-md border border-warning/30 bg-warning-subtle p-5">
      <h2 className="font-display text-lg text-warning">
        {pickByLocale(locale, JS.lockedHeading)}
      </h2>
      <p className="mt-0.5 text-xs italic text-warning/70">
        {pickByLocale(locale, S.jurisdictionSettings.lockedTagline)}
      </p>
      <p className="mt-3 text-sm text-foreground/80">
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
        className="mt-4 inline-flex items-center rounded border border-warning/40 px-3 py-1.5 text-xs text-warning hover:bg-warning-subtle"
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
        {pickByLocale(locale, JS.overrideHeading)}
      </h2>
      <p className="mt-0.5 text-xs italic text-muted-foreground">
        {pickByLocale(locale, S.jurisdictionSettings.overrideTagline)}
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
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
      <p className="mt-3 text-xs text-muted-foreground">
        {pickByLocale(locale, JS.seededFootnote)}
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
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
    </div>
  );
}
