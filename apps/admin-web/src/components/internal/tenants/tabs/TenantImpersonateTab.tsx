'use client';

import { Button } from '@borjie/design-system';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

interface TenantImpersonateTabProps {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly initialLocale?: Locale;
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
const S = {
  title: { en: 'Audited operator impersonation', sw: 'Kuiga opereta kwa ukaguzi' },
  body: {
    en: 'A signed bearer is minted server-side, scoped to this tenant, and emits an immutable audit event. Sessions self-expire after 60 minutes.',
    sw: 'Tikiti iliyosainiwa hutengenezwa upande wa seva, ikiwa imefungwa kwa mteja huyu, na hutoa tukio la ukaguzi lisiloweza kubadilishwa. Vipindi hujifutia muda baada ya dakika 60.',
  },
  start: { en: 'Start impersonation session', sw: 'Anzisha kipindi cha kuiga' },
  notAvailable: {
    en: 'Not yet available — pending gateway wiring.',
    sw: 'Bado haipatikani — inasubiri uunganishaji wa lango.',
  },
  disabledTitle: {
    en: "Impersonation isn't available yet — the gateway route is not wired. Tracked for the gateway wave.",
    sw: 'Kuiga bado hakupatikani — njia ya lango haijaunganishwa. Inafuatiliwa kwa wimbi la lango.',
  },
} as const;

export function TenantImpersonateTab({
  tenantName,
  initialLocale,
}: TenantImpersonateTabProps): JSX.Element {
  const locale = useLocale(initialLocale);
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-warning/40 bg-warning-subtle p-6">
        <h3 className="text-sm font-medium text-foreground mb-2">
          {pickByLocale(locale, S.title)}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {pickByLocale(locale, S.body)}
          {tenantName ? ` (${tenantName})` : ''}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled
          title={pickByLocale(locale, S.disabledTitle)}
        >
          {pickByLocale(locale, S.start)}
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">
          {pickByLocale(locale, S.notAvailable)}
        </p>
      </div>
    </div>
  );
}
