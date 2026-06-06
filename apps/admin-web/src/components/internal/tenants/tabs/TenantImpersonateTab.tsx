'use client';

interface TenantImpersonateTabProps {
  readonly tenantId: string;
  readonly tenantName: string;
}

/**
 * Audited operator impersonation.
 *
 * AD-8: the gateway impersonation route is not wired yet — the
 * `useImpersonate` hook 404s. Rather than let operators trigger a dead
 * action (which would mint nothing and silently fail), the affordance is
 * disabled with an explanatory notice. Re-enable the mutation flow once
 * `POST /tenants/:id/impersonate` lands on the gateway.
 */
export function TenantImpersonateTab({ tenantName }: TenantImpersonateTabProps): JSX.Element {
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
          disabled
          title="Impersonation isn't available yet — the gateway route is not wired. Tracked for the gateway wave."
          className="cursor-not-allowed rounded-md border border-border bg-surface-sunken px-4 py-2 text-xs font-medium text-neutral-500 opacity-60"
        >
          Start impersonation session
        </button>
        <p className="mt-3 text-xs text-neutral-500">
          Not yet available — pending gateway wiring.
        </p>
      </div>
    </div>
  );
}
