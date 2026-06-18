'use client';

import { useState } from 'react';
import { Button } from '@borjie/design-system';
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
        <Button
          type="button"
          variant="link"
          size="sm"
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
          className="text-signal-500"
        >
          Activate
        </Button>
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
      <Button
        type="button"
        variant="link"
        size="sm"
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
        className="text-warning"
      >
        Suspend
      </Button>
      <Toast
        message={toast}
        tone={setStatus.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </>
  );
}
