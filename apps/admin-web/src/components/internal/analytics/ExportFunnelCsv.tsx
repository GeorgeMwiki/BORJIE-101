'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Toast } from '../Toast';

interface ExportResult {
  readonly url: string;
}

export function ExportFunnelCsv(): JSX.Element {
  const [toast, setToast] = useState<string | null>(null);

  const exportCsv = useMutation({
    mutationFn: async (): Promise<ExportResult> => {
      const res = await apiClient.post<ExportResult>('/analytics/funnel/export', {}, async () => ({
        url: 'data:text/csv;charset=utf-8,step,count%0ASign-up,412%0ATenant,286%0AFirst%20operator,218%0AFirst%20decision,174%0APaid,96',
      }));
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
  });

  return (
    <>
      <button
        type="button"
        disabled={exportCsv.isPending}
        onClick={() =>
          exportCsv.mutate(undefined, {
            onSuccess: (res) => {
              if (typeof window !== 'undefined') window.open(res.url, '_blank', 'noopener,noreferrer');
              setToast('Funnel exported');
            },
            onError: (err) => setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
          })
        }
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-foreground hover:bg-surface-sunken disabled:opacity-50"
      >
        {exportCsv.isPending ? 'Exporting…' : 'Export funnel CSV'}
      </button>
      <Toast message={toast} tone={exportCsv.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </>
  );
}
