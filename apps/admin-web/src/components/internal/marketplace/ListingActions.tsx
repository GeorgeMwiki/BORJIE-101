'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { Toast } from '../Toast';
import { localizeApiError } from '@borjie/error-catalog';

interface ListingActionsProps {
  readonly id: string;
  readonly title: string;
  readonly status: 'Live' | 'Flagged' | 'Hidden';
  readonly initialLocale?: Locale;
}

const S = {
  hide: { en: 'Hide listing', sw: 'Ficha tangazo' },
  restore: { en: 'Restore listing', sw: 'Rejesha tangazo' },
  hidden: { en: 'hidden', sw: 'imefichwa' },
  restored: { en: 'restored', sw: 'imerejeshwa' },
  failed: { en: 'Failed', sw: 'Imeshindwa' },
  unknown: { en: 'unknown', sw: 'haijulikani' },
} as const;

export function ListingActions({
  id,
  title,
  status,
  initialLocale,
}: ListingActionsProps): JSX.Element {
  const locale = useLocale(initialLocale);
  const [toast, setToast] = useState<string | null>(null);

  const next = status === 'Hidden' ? 'restore' : 'hide';
  const mutate = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ readonly id: string }>(
        `/marketplace/${id}/${next}`,
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
        disabled={mutate.isPending}
        onClick={() =>
          mutate.mutate(undefined, {
            onSuccess: () =>
              setToast(
                `${title}: ${next === 'restore' ? pickByLocale(locale, S.restored) : pickByLocale(locale, S.hidden)}`,
              ),
            onError: (err) =>
              setToast(
                `${pickByLocale(locale, S.failed)}: ${localizeApiError(err, locale)}`,
              ),
          })
        }
        className="text-xs text-signal-500 hover:underline disabled:opacity-50"
      >
        {next === 'hide' ? pickByLocale(locale, S.hide) : pickByLocale(locale, S.restore)}
      </button>
      <Toast message={toast} tone={mutate.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </>
  );
}
