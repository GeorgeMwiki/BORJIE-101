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

  if (isSuspended) {
    // POST /api/v1/mining/internal/tenants/:id/activate now exists (Wave A).
    // Wire the Activate button to useSetTenantStatus({ status: 'Active' })
    // which calls the gateway activate route.
    return (
      <>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setStatus.mutate(
              { id: tenant.id, status: 'Active' },
              {
                onSuccess: () => setToast(`${tenant.name} → Active`),
                onError: (err) =>
                  setToast(
                    `Failed: ${err instanceof Error ? err.message : 'unknown'}`,
                  ),
              },
            );
          }}
          disabled={setStatus.isPending}
          className="text-xs text-signal-500 hover:underline disabled:opacity-50"
        >
          Activate
        </button>
        <Toast
          message={toast}
          tone={setStatus.isError ? 'danger' : 'success'}
          onDismiss={() => setToast(null)}
        />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setStatus.mutate(
            { id: tenant.id, status: 'Suspended' },
            {
              onSuccess: () => setToast(`${tenant.name} → Suspended`),
              onError: (err) =>
                setToast(
                  `Failed: ${err instanceof Error ? err.message : 'unknown'}`,
                ),
            },
          );
        }}
        disabled={setStatus.isPending}
        className="text-xs text-warning hover:underline disabled:opacity-50"
      >
        Suspend
      </button>
      <Toast
        message={toast}
        tone={setStatus.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </>
  );
}
