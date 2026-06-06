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

  // AD-8: the gateway only exposes a suspend transition. Re-activating a
  // suspended tenant (and every other status flip) throws in
  // `useSetTenantStatus`, so the Activate affordance is disabled with an
  // explanatory tooltip instead of letting operators hit a dead action.
  // Re-enable once the gateway ships the activate/status route.
  if (isSuspended) {
    return (
      <button
        type="button"
        disabled
        title="Re-activation isn't available yet — the gateway only exposes a suspend transition. Tracked for the gateway wave."
        className="cursor-not-allowed text-xs text-neutral-500 opacity-60"
      >
        Activate
      </button>
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
              onError: (err) => setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
            }
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
