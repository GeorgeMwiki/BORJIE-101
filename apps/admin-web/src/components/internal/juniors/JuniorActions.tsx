'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Toast } from '../Toast';
import type { Junior, JuniorStatus } from '@/lib/internal/types';

interface JuniorActionsProps {
  readonly junior: Junior;
}

export function JuniorActions({ junior }: JuniorActionsProps): JSX.Element {
  const [status, setStatus] = useState<JuniorStatus>(junior.status);
  const [toast, setToast] = useState<string | null>(null);

  const mutate = useMutation({
    mutationFn: async (next: JuniorStatus): Promise<Junior> => {
      const res = await apiClient.patch<Junior>(`/juniors/${junior.id}/status`, { status: next });
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
    onSuccess: (next) => {
      setStatus(next.status);
      setToast(`${junior.name} → ${next.status}`);
    },
    onError: (err) => setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
  });

  const isSuspended = status === 'Suspended';
  const next: JuniorStatus = isSuspended ? 'Active' : 'Suspended';

  return (
    <>
      <button
        type="button"
        disabled={mutate.isPending}
        onClick={() => mutate.mutate(next)}
        className={`text-xs hover:underline disabled:opacity-50 ${
          isSuspended ? 'text-success' : 'text-warning'
        }`}
      >
        {isSuspended ? 'Reactivate' : 'Suspend'}
      </button>
      <Toast message={toast} tone={mutate.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </>
  );
}
