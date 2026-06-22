'use client';

import { useState } from 'react';
import { Skeleton, EmptyState } from '@borjie/design-system';
import {
  useFeatureFlagsQuery,
  useToggleFeatureFlag,
  type FeatureFlag,
} from '@/lib/internal/queries/feature-flags';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';
import { Toast } from '../Toast';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

const S = {
  loading: { en: 'Loading flags…', sw: 'Inapakia bendera…' },
  emptyTitle: { en: 'No feature flags defined', sw: 'Hakuna bendera za vipengele zilizofafanuliwa' },
  emptyBody: {
    en: 'Platform feature flags appear here once they are registered on the gateway.',
    sw: 'Bendera za vipengele za jukwaa huonekana hapa mara zinaposajiliwa kwenye lango.',
  },
  enable: { en: 'Enable', sw: 'Wezesha' },
  disable: { en: 'Disable', sw: 'Zima' },
  on: { en: 'On', sw: 'Imewashwa' },
  off: { en: 'Off', sw: 'Imezimwa' },
  enabled: { en: 'enabled', sw: 'imewezeshwa' },
  disabled: { en: 'disabled', sw: 'imezimwa' },
  failed: { en: 'Failed', sw: 'Imeshindwa' },
  unknown: { en: 'unknown', sw: 'haijulikani' },
} as const;

/**
 * Live platform feature-flag catalog with an inline enable/disable.
 *
 * Binds to GET /api/v1/mining/internal/feature-flags and flips the
 * platform default via PATCH /:flagKey/rollout ({ defaultEnabled }).
 * The canonical `feature_flags` row is a BOOLEAN on/off — not a rollout
 * percentage — so the control is a toggle, not a slider.
 */
function FlagToggle({
  flag,
  locale,
}: {
  readonly flag: FeatureFlag;
  readonly locale: Locale;
}): JSX.Element {
  const toggle = useToggleFeatureFlag();
  const [toast, setToast] = useState<string | null>(null);
  const next = !flag.defaultEnabled;

  return (
    <>
      <button
        type="button"
        disabled={toggle.isPending}
        onClick={() =>
          toggle.mutate(
            { flagKey: flag.flagKey, defaultEnabled: next },
            {
              onSuccess: (res) =>
                setToast(
                  `${res.flagKey} ${
                    res.defaultEnabled
                      ? pickByLocale(locale, S.enabled)
                      : pickByLocale(locale, S.disabled)
                  }`,
                ),
              onError: (err) =>
                setToast(
                  `${pickByLocale(locale, S.failed)}: ${
                    err instanceof Error ? err.message : pickByLocale(locale, S.unknown)
                  }`,
                ),
            },
          )
        }
        className={`text-xs hover:underline disabled:opacity-50 ${
          flag.defaultEnabled ? 'text-warning' : 'text-success'
        }`}
      >
        {flag.defaultEnabled
          ? pickByLocale(locale, S.disable)
          : pickByLocale(locale, S.enable)}
      </button>
      <Toast
        message={toast}
        tone={toggle.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </>
  );
}

export function FeatureFlagsList({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useFeatureFlagsQuery();

  if (query.isPending) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <Skeleton className="h-12 w-full rounded-md" />
        <Skeleton className="h-12 w-full rounded-md" />
        <Skeleton className="h-12 w-2/3 rounded-md" />
      </div>
    );
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{query.error.message}</p>;
  }

  const rows = query.data?.rows ?? [];

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
        <DataSourceBadge source={query.data?.source ?? 'mock'} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {rows.map((flag) => (
          <article
            key={flag.flagKey}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <div>
              <p className="font-mono text-sm text-foreground">{flag.flagKey}</p>
              {flag.description ? (
                <p className="text-xs text-muted-foreground">{flag.description}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <StubBadge tone={flag.defaultEnabled ? 'success' : 'neutral'}>
                {flag.defaultEnabled
                  ? pickByLocale(locale, S.on)
                  : pickByLocale(locale, S.off)}
              </StubBadge>
              <FlagToggle flag={flag} locale={locale} />
            </div>
          </article>
        ))}
      </div>
      <DataSourceBadge source={query.data?.source ?? 'mock'} />
    </div>
  );
}
