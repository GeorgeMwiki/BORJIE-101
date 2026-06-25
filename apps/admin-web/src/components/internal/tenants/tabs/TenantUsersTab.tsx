'use client';

import { Skeleton, Alert } from '@borjie/design-system';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { useTenantOperatorsQuery } from '@/lib/internal/queries/tenant-detail';

const S = {
  lastActive: { en: 'Last active', sw: 'Mwisho kuonekana' },
  never: { en: 'never', sw: 'kamwe' },
  loading: { en: 'Loading operators…', sw: 'Inapakia waendeshaji…' },
  unavailable: { en: 'Operators unavailable', sw: 'Waendeshaji hawapatikani' },
  empty: {
    en: 'No active operators for this tenant.',
    sw: 'Hakuna waendeshaji hai kwa mteja huyu.',
  },
} as const;

/**
 * Closed {en,sw} map for the `borjie_user_role` enum the operators endpoint
 * emits (plus the gateway's `'operator'` fallback). One canonical sw term per
 * role — never dump the raw snake_case enum under either locale.
 */
const ROLE_LABELS = {
  owner: { en: 'Owner', sw: 'Mmiliki' },
  admin: { en: 'Admin', sw: 'Msimamizi' },
  site_manager: { en: 'Site manager', sw: 'Msimamizi wa tovuti' },
  supervisor: { en: 'Supervisor', sw: 'Mratibu' },
  driver: { en: 'Driver', sw: 'Dereva' },
  geologist: { en: 'Geologist', sw: 'Mwanajiolojia' },
  stores: { en: 'Stores', sw: 'Stoo' },
  qc_officer: { en: 'QC officer', sw: 'Afisa wa udhibiti wa ubora' },
  buyer: { en: 'Buyer', sw: 'Mnunuzi' },
  borjie_team: { en: 'Borjie team', sw: 'Timu ya Borjie' },
  operator: { en: 'Operator', sw: 'Opereta' },
} as const;

function roleLabel(role: string, locale: Locale): string {
  const entry =
    (ROLE_LABELS as Record<string, { en: string; sw: string }>)[role] ??
    ROLE_LABELS.operator;
  return pickByLocale(locale, entry);
}

/** Absolute timestamp (YYYY-MM-DD HH:mm) — honest + no clock dependency. */
function formatLastActive(iso: string | null, locale: Locale): string {
  if (!iso) return pickByLocale(locale, S.never);
  return iso.replace('T', ' ').slice(0, 16);
}

/**
 * LIVE operator roster from GET /mining/internal/tenants/:id/operators
 * (active employment-class memberships joined to the user record). DS Skeleton
 * while loading, DS Alert on error, honest empty state when the tenant has no
 * active operators — no mock rows.
 */
export function TenantUsersTab({
  tenantId,
  initialLocale,
}: {
  readonly tenantId: string;
  readonly initialLocale?: Locale;
}): JSX.Element {
  const locale = useLocale(initialLocale);
  const { data, isPending, isError, error } = useTenantOperatorsQuery(tenantId);

  if (isPending) {
    return (
      <Skeleton
        className="h-48 w-full rounded-lg"
        aria-label={pickByLocale(locale, S.loading)}
      />
    );
  }
  if (isError) {
    return (
      <Alert variant="error" title={pickByLocale(locale, S.unavailable)}>
        {error.message}
      </Alert>
    );
  }

  const operators = data ?? [];

  return (
    <div className="rounded-lg border border-border bg-surface divide-y divide-border">
      {operators.length === 0 ? (
        <p className="px-4 py-6 text-xs text-muted-foreground">
          {pickByLocale(locale, S.empty)}
        </p>
      ) : (
        operators.map((op) => (
          <div
            key={op.id}
            className="px-4 py-3 flex items-center justify-between"
          >
            <div>
              <p className="text-sm text-foreground">{op.name}</p>
              <p className="text-xs text-muted-foreground">
                {roleLabel(op.role, locale)}
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              {pickByLocale(locale, S.lastActive)}{' '}
              {formatLastActive(op.lastActiveAt, locale)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
