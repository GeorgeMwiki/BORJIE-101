'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Toast } from '../Toast';

interface ListingActionsProps {
  readonly id: string;
  readonly title: string;
  readonly status: 'Live' | 'Flagged' | 'Hidden';
}

export function ListingActions({ id, title, status }: ListingActionsProps): JSX.Element {
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
            onSuccess: () => setToast(`${title}: ${next}d`),
            onError: (err) => setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
          })
        }
        className="text-xs text-signal-500 hover:underline disabled:opacity-50"
      >
        {next === 'hide' ? 'Hide listing' : 'Restore listing'}
      </button>
      <Toast message={toast} tone={mutate.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </>
  );
}
