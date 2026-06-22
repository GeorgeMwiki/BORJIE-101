'use client';

import { useState } from 'react';
import { Button } from '@borjie/design-system';
import { useSetTenantStatus } from '@/lib/internal/queries/tenants';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import type { Tenant } from '@/lib/internal/types';
import { Toast } from '../Toast';

interface TenantActionsProps {
  readonly tenant: Tenant;
  readonly initialLocale?: Locale;
}

const S = {
  activate: { en: 'Activate', sw: 'Wezesha' },
  suspend: { en: 'Suspend', sw: 'Simamisha' },
} as const;

export function TenantActions({ tenant, initialLocale }: TenantActionsProps): JSX.Element {
  const locale = useLocale(initialLocale);
  const setStatus = useSetTenantStatus();
  const [toast, setToast] = useState<string | null>(null);

  const isSuspended = tenant.status === 'Suspended';
  const nextStatus = isSuspended ? 'Active' : 'Suspended';
  const label = isSuspended ? pickByLocale(locale, S.activate) : pickByLocale(locale, S.suspend);

  return (
    <>
      <Button
        type="button"
        variant="link"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          setStatus.mutate(
            { id: tenant.id, status: nextStatus },
            {
              onSuccess: () => setToast(`${tenant.name} → ${nextStatus}`),
              onError: (err) =>
                setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
            },
          );
        }}
        disabled={setStatus.isPending}
        loading={setStatus.isPending}
        className={isSuspended ? 'text-signal-500' : 'text-warning'}
      >
        {label}
      </Button>
      <Toast
        message={toast}
        tone={setStatus.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </>
  );
}
