'use client';

import { useState } from 'react';
import {
  useFeatureFlagsQuery,
  useToggleFeatureFlag,
  type FeatureFlag,
} from '@/lib/internal/queries/feature-flags';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';
import { Toast } from '../Toast';

/**
 * Live platform feature-flag catalog with an inline enable/disable.
 *
 * Binds to GET /api/v1/mining/internal/feature-flags and flips the
 * platform default via PATCH /:flagKey/rollout ({ defaultEnabled }).
 * The canonical `feature_flags` row is a BOOLEAN on/off — not a rollout
 * percentage — so the control is a toggle, not a slider.
 */
function FlagToggle({ flag }: { readonly flag: FeatureFlag }): JSX.Element {
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
                  `${res.flagKey} ${res.defaultEnabled ? 'enabled' : 'disabled'}`,
                ),
              onError: (err) =>
                setToast(
                  `Failed: ${err instanceof Error ? err.message : 'unknown'}`,
                ),
            },
          )
        }
        className={`text-xs hover:underline disabled:opacity-50 ${
          flag.defaultEnabled ? 'text-warning' : 'text-success'
        }`}
      >
        {flag.defaultEnabled ? 'Disable' : 'Enable'}
      </button>
      <Toast
        message={toast}
        tone={toggle.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </>
  );
}

export function FeatureFlagsList(): JSX.Element {
  const query = useFeatureFlagsQuery();

  if (query.isPending) {
    return <p className="text-sm text-neutral-500">Loading flags…</p>;
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{query.error.message}</p>;
  }

  const rows = query.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-neutral-500">
            No feature flags defined.
          </p>
        ) : (
          rows.map((flag) => (
            <article
              key={flag.flagKey}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div>
                <p className="font-mono text-sm text-foreground">{flag.flagKey}</p>
                {flag.description ? (
                  <p className="text-xs text-neutral-400">{flag.description}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <StubBadge tone={flag.defaultEnabled ? 'success' : 'neutral'}>
                  {flag.defaultEnabled ? 'On' : 'Off'}
                </StubBadge>
                <FlagToggle flag={flag} />
              </div>
            </article>
          ))
        )}
      </div>
      <DataSourceBadge source={query.data?.source ?? 'mock'} />
    </div>
  );
}
