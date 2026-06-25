import { Button } from '@borjie/design-system';
import { QueryProvider } from '@/components/internal/QueryProvider';
import { TenantDirectory } from '@/components/internal/tenants/TenantDirectory';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';

/**
 * Tenant directory — dense data table at the top-level admin URL.
 *
 * Mirrors the reference admin tenants page composition: page header
 * with eyebrow + action affordance, then the dense filterable +
 * paginated TenantDirectory component (sticky header, plan + status
 * filter chips, row click opens detail). The component is shared with
 * `/internal/tenants` — this route is the portal-parity entry point.
 *
 * SINGLE LANGUAGE PER LOCALE (canon): the header eyebrow + title +
 * subtitle resolve to the active locale via `pickByLocale`. The previous
 * eyebrow hard-rendered "Tenants · Wapangaji" (EN+SW together).
 *
 * GLOSSARY (canon, one term per concept): the SaaS "tenant" renders in
 * Swahili as `Wateja` / `Mteja` (clients), NEVER `Wapangaji` / `Mpangaji`
 * — the latter reads as property "renters" (real-estate residue) to a
 * Tanzanian operator. The English copy keeps "tenant" (correct SaaS vocab).
 */
export default async function TenantsPage(): Promise<JSX.Element> {
  const locale = await readLocaleFromServerCookies();
  return (
    <QueryProvider>
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div>
            <p className="font-mono text-tiny uppercase tracking-widest text-signal-500">
              {pickByLocale(locale, { en: 'Tenants', sw: 'Wateja' })}
            </p>
            <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
              {pickByLocale(locale, {
                en: 'Tenant directory',
                sw: 'Orodha ya wateja',
              })}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {pickByLocale(locale, {
                en: 'Every Borjie tenant — plan, status, ARR, last-active. Row click opens the tenant detail drawer. Filter by plan or status; search by name or primary commodity.',
                sw: 'Kila mteja wa Borjie — mpango, hali, ARR, alipokuwa hai mwisho. Bonyeza safu kufungua dirisha la maelezo ya mteja. Chuja kwa mpango au hali; tafuta kwa jina au madini makuu.',
              })}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled
            title={pickByLocale(locale, {
              en: 'Provisioning form lands with self-serve tenant onboarding',
              sw: 'Fomu ya usajili itapatikana na ujiandikishaji wa mteja wa kujihudumia',
            })}
          >
            {pickByLocale(locale, { en: 'New tenant', sw: 'Mteja mpya' })}
          </Button>
        </header>

        <TenantDirectory initialLocale={locale} />
      </div>
    </QueryProvider>
  );
}
