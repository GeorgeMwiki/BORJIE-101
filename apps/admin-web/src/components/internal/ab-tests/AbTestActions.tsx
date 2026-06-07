'use client';

import { useState } from 'react';
import { usePromoteWinner } from '@/lib/internal/queries/ab-tests';
import { Toast } from '../Toast';

interface AbTestActionsProps {
  readonly id: string;
  readonly variant: string;
}

/**
 * Inline "Promote winner" action for one experiment row. Calls
 * POST /api/v1/mining/internal/ab-tests/:id/promote-winner via the shared
 * `usePromoteWinner` mutation so the list re-fetches on success.
 */
export function AbTestActions({ id, variant }: AbTestActionsProps): JSX.Element {
  const [toast, setToast] = useState<string | null>(null);
  const promote = usePromoteWinner();

  return (
    <>
      <button
        type="button"
        disabled={promote.isPending}
        onClick={() =>
          promote.mutate(id, {
            onSuccess: () => setToast(`${variant}: promoted to production`),
            onError: (err) =>
              setToast(
                `Failed: ${err instanceof Error ? err.message : 'unknown'}`,
              ),
          })
        }
        className="text-xs text-signal-500 hover:underline disabled:opacity-50"
      >
        {promote.isPending ? 'Promoting…' : 'Promote winner'}
      </button>
      <Toast
        message={toast}
        tone={promote.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </>
  );
}
