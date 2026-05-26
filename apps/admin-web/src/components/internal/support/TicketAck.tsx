'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Toast } from '../Toast';

export function TicketAck({ id }: { readonly id: string }): JSX.Element {
  const [toast, setToast] = useState<string | null>(null);

  const ack = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ readonly id: string }>(`/support/${id}/acknowledge`, {});
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
  });

  return (
    <>
      <button
        type="button"
        disabled={ack.isPending}
        onClick={() =>
          ack.mutate(undefined, {
            onSuccess: () => setToast(`${id} acknowledged`),
            onError: (err) => setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
          })
        }
        className="text-xs text-signal-500 hover:underline disabled:opacity-50"
      >
        {ack.isPending ? 'Ack…' : 'Acknowledge'}
      </button>
      <Toast message={toast} tone={ack.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </>
  );
}
