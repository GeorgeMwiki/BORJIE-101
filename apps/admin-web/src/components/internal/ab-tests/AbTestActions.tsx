'use client';

import { useState } from 'react';
import { usePromoteWinner } from '@/lib/internal/queries/ab-tests';
import { Toast } from '../Toast';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { localizeApiError } from '@borjie/error-catalog';

interface AbTestActionsProps {
  readonly id: string;
  readonly variant: string;
  readonly initialLocale?: Locale;
}

const S = {
  promoting: { en: 'Promoting…', sw: 'Inapandisha…' },
  promote: { en: 'Promote winner', sw: 'Pandisha mshindi' },
  promoted: { en: 'promoted to production', sw: 'imepandishwa kwenye uzalishaji' },
  failed: { en: 'Failed', sw: 'Imeshindwa' },
  unknown: { en: 'unknown', sw: 'haijulikani' },
} as const;

/**
 * Inline "Promote winner" action for one experiment row. Calls
 * POST /api/v1/mining/internal/ab-tests/:id/promote-winner via the shared
 * `usePromoteWinner` mutation so the list re-fetches on success.
 */
export function AbTestActions({ id, variant, initialLocale }: AbTestActionsProps): JSX.Element {
  const locale = useLocale(initialLocale);
  const [toast, setToast] = useState<string | null>(null);
  const promote = usePromoteWinner();

  return (
    <>
      <button
        type="button"
        disabled={promote.isPending}
        onClick={() =>
          promote.mutate(id, {
            onSuccess: () => setToast(`${variant}: ${pickByLocale(locale, S.promoted)}`),
            onError: (err) =>
              setToast(
                `${pickByLocale(locale, S.failed)}: ${
                  localizeApiError(err, locale)
                }`,
              ),
          })
        }
        className="text-xs text-signal-500 hover:underline disabled:opacity-50"
      >
        {promote.isPending ? pickByLocale(locale, S.promoting) : pickByLocale(locale, S.promote)}
      </button>
      <Toast
        message={toast}
        tone={promote.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </>
  );
}
