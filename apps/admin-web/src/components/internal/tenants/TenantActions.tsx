'use client';

import { useState } from 'react';
import { useSetTenantStatus } from '@/lib/internal/queries/tenants';
import type { Tenant } from '@/lib/internal/types';
import { Toast } from '../Toast';

interface TenantActionsProps {
  readonly tenant: Tenant;
}

export function TenantActions({ tenant }: TenantActionsProps): JSX.Element {
  const setStatus = useSetTenantStatus();
  const [toast, setToast] = useState<string | null>(null);

  const isSuspended = tenant.status === 'Suspended';
  const nextStatus = isSuspended ? 'Active' : 'Suspended';
  const label = isSuspended ? 'Activate' : 'Suspend';

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setStatus.mutate(
            { id: tenant.id, status: nextStatus },
            {
              onSuccess: () => setToast(`${tenant.name} → ${nextStatus}`),
              onError: (err) => setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
            }
          );
        }}
        disabled={setStatus.isPending}
        className={`text-xs hover:underline disabled:opacity-50 ${
          isSuspended ? 'text-success' : 'text-warning'
        }`}
      >
        {label}
      </button>
      <Toast
        message={toast}
        tone={setStatus.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </>
  );
}
