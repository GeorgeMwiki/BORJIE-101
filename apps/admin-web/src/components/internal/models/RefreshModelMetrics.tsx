'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { Toast } from '../Toast';
import { localizeApiError } from '@borjie/error-catalog';

const S = {
  refreshedAt: { en: 'Metrics refreshed at', sw: 'Vipimo vimesasishwa saa' },
  refreshFailed: { en: 'Refresh failed', sw: 'Kusasisha kumeshindwa' },
  unknown: { en: 'unknown', sw: 'haijulikani' },
  refreshing: { en: 'Refreshing…', sw: 'Inasasisha…' },
  refresh: { en: 'Refresh metrics', sw: 'Sasisha vipimo' },
} as const;

export function RefreshModelMetrics({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ readonly refreshedAt: string }>(
        '/models/refresh',
        {},
      );
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
  });

  return (
    <>
      <button
        type="button"
        onClick={() =>
          refresh.mutate(undefined, {
            onSuccess: (res) =>
              setToast(
                `${pickByLocale(locale, S.refreshedAt)} ${res.refreshedAt.replace('T', ' ').slice(0, 16)}`,
              ),
            onError: (err) =>
              setToast(
                `${pickByLocale(locale, S.refreshFailed)}: ${localizeApiError(err, locale)}`,
              ),
          })
        }
        disabled={refresh.isPending}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-foreground hover:bg-surface-sunken disabled:opacity-50"
      >
        {refresh.isPending ? pickByLocale(locale, S.refreshing) : pickByLocale(locale, S.refresh)}
      </button>
      <Toast message={toast} tone={refresh.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </>
  );
}
