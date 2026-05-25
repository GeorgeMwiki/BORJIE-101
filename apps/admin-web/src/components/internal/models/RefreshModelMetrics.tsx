'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Toast } from '../Toast';

export function RefreshModelMetrics(): JSX.Element {
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ readonly refreshedAt: string }>(
        '/models/refresh',
        {},
        async () => ({ refreshedAt: new Date().toISOString() })
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
            onSuccess: (res) => setToast(`Metrics refreshed at ${res.refreshedAt.replace('T', ' ').slice(0, 16)}`),
            onError: (err) => setToast(`Refresh failed: ${err instanceof Error ? err.message : 'unknown'}`),
          })
        }
        disabled={refresh.isPending}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-foreground hover:bg-surface-sunken disabled:opacity-50"
      >
        {refresh.isPending ? 'Refreshing…' : 'Refresh metrics'}
      </button>
      <Toast message={toast} tone={refresh.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </>
  );
}
