'use client';

import { useState } from 'react';
import { ConfirmModal } from '../../ConfirmModal';
import { Toast } from '../../Toast';
import { useImpersonate } from '@/lib/internal/queries/tenants';

interface TenantImpersonateTabProps {
  readonly tenantId: string;
  readonly tenantName: string;
}

export function TenantImpersonateTab({ tenantId, tenantName }: TenantImpersonateTabProps): JSX.Element {
  const impersonate = useImpersonate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const handle = () => {
    impersonate.mutate(tenantId, {
      onSuccess: (res) => {
        setConfirmOpen(false);
        if (!res.ok) {
          setToast(`Impersonation failed: ${res.message}`);
          return;
        }
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(`impersonate_${tenantId}`, res.data.bearer);
          window.open(res.data.portalUrl, '_blank', 'noopener,noreferrer');
        }
        setToast(`Opened impersonation session for ${tenantName}`);
      },
      onError: () => setToast('Impersonation request failed.'),
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-warning/40 bg-warning/5 p-6">
        <h3 className="text-sm font-medium text-foreground mb-2">Audited operator impersonation</h3>
        <p className="text-xs text-neutral-400 mb-4">
          A signed bearer is minted server-side, scoped to {tenantName}, and emits an immutable audit event. Sessions
          self-expire after 60 minutes.
        </p>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="rounded-md border border-warning/40 bg-warning/10 px-4 py-2 text-xs font-medium text-warning hover:bg-warning/20"
        >
          Start impersonation session
        </button>
      </div>

      <ConfirmModal
        open={confirmOpen}
        tone="warn"
        title="Confirm impersonation"
        body={
          <>
            You are about to act as an operator inside <strong className="text-foreground">{tenantName}</strong>. Every
            action you take will be logged against your operator identity and the tenant.
          </>
        }
        confirmLabel="I understand — start session"
        busy={impersonate.isPending}
        onConfirm={handle}
        onCancel={() => setConfirmOpen(false)}
      />
      <Toast message={toast} tone="info" onDismiss={() => setToast(null)} />
    </div>
  );
}
