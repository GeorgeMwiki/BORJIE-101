'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Toast } from '../Toast';

interface AbTestActionsProps {
  readonly id: string;
  readonly variant: string;
}

export function AbTestActions({ id, variant }: AbTestActionsProps): JSX.Element {
  const [toast, setToast] = useState<string | null>(null);

  const promote = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ readonly id: string }>(
        `/ab-tests/${id}/promote-winner`,
        {},
        async () => ({ id })
      );
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
  });

  return (
    <>
      <button
        type="button"
        disabled={promote.isPending}
        onClick={() =>
          promote.mutate(undefined, {
            onSuccess: () => setToast(`${variant}: winner queued for production`),
            onError: (err) => setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
          })
        }
        className="text-xs text-signal-500 hover:underline disabled:opacity-50"
      >
        {promote.isPending ? 'Queueing…' : 'Promote winner'}
      </button>
      <Toast message={toast} tone={promote.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </>
  );
}
