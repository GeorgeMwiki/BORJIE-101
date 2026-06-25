'use client';

import { useState } from 'react';
import { Button } from '@borjie/design-system';
import { useSetTenantStatus } from '@/lib/internal/queries/tenants';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import type { Tenant, TenantStatus } from '@/lib/internal/types';
import { Toast } from '../Toast';
import { localizeApiError } from '@borjie/error-catalog';

interface TenantActionsProps {
  readonly tenant: Tenant;
  readonly initialLocale?: Locale;
}

const S = {
  activate: { en: 'Activate', sw: 'Wezesha' },
  suspend: { en: 'Suspend', sw: 'Simamisha' },
  statusActive: { en: 'Active', sw: 'Hai' },
  statusSuspended: { en: 'Suspended', sw: 'Imesimamishwa' },
  failedUnknown: { en: 'unknown', sw: 'haijulikani' },
} as const;

type Transition = 'activate' | 'suspend';

/**
 * Which status transitions an operator may drive from the tenant's CURRENT
 * lifecycle state, matching the gateway's supported moves
 * (`POST /tenants/:id/{activate,suspend}`):
 *   - Active     → may suspend
 *   - Suspended  → may activate
 *   - Trial      → may activate (provision) OR suspend (pending/trial had no
 *                  Activate affordance before — only Suspend; AD-tier fix)
 *   - Past due   → may activate (recover) OR suspend
 * Each entry carries the target `TenantStatus` the mutation posts.
 */
const TRANSITIONS_BY_STATUS: Record<
  TenantStatus,
  ReadonlyArray<{ readonly kind: Transition; readonly to: TenantStatus }>
> = {
  Active: [{ kind: 'suspend', to: 'Suspended' }],
  Suspended: [{ kind: 'activate', to: 'Active' }],
  Trial: [
    { kind: 'activate', to: 'Active' },
    { kind: 'suspend', to: 'Suspended' },
  ],
  'Past due': [
    { kind: 'activate', to: 'Active' },
    { kind: 'suspend', to: 'Suspended' },
  ],
};

export function TenantActions({ tenant, initialLocale }: TenantActionsProps): JSX.Element {
  const locale = useLocale(initialLocale);
  const setStatus = useSetTenantStatus();
  const [toast, setToast] = useState<string | null>(null);

  const transitions = TRANSITIONS_BY_STATUS[tenant.status];

  const labelFor = (kind: Transition): string =>
    kind === 'activate'
      ? pickByLocale(locale, S.activate)
      : pickByLocale(locale, S.suspend);

  const nextStatusLabelFor = (to: TenantStatus): string =>
    to === 'Active'
      ? pickByLocale(locale, S.statusActive)
      : pickByLocale(locale, S.statusSuspended);

  return (
    <>
      {transitions.map(({ kind, to }) => (
        <Button
          key={kind}
          type="button"
          variant="link"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setStatus.mutate(
              { id: tenant.id, status: to },
              {
                onSuccess: () =>
                  setToast(`${tenant.name} → ${nextStatusLabelFor(to)}`),
                onError: (err) =>
                  setToast(
                    pickByLocale(locale, {
                      en: `Failed: ${localizeApiError(err, locale)}`,
                      sw: `Imeshindwa: ${localizeApiError(err, locale)}`,
                    }),
                  ),
              },
            );
          }}
          disabled={setStatus.isPending}
          loading={setStatus.isPending}
          className={kind === 'activate' ? 'text-signal-500' : 'text-warning'}
        >
          {labelFor(kind)}
        </Button>
      ))}
      <Toast
        message={toast}
        tone={setStatus.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </>
  );
}
