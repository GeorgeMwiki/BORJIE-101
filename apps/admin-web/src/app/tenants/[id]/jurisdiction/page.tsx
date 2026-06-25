import { QueryProvider } from '@/components/internal/QueryProvider';
import { pickByLocale } from '@/lib/locale-shared';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { TenantJurisdictionPanel } from './TenantJurisdictionPanel';

const STRINGS = {
  eyebrow: { en: 'Tenant · Jurisdiction', sw: 'Mteja · Mamlaka' },
  title: { en: 'Jurisdiction override', sw: 'Ubadilishaji wa mamlaka' },
  body: {
    en: 'Tenants are LOCKED to their signup jurisdiction. Only Borjie internal admin can re-assign — and the change requires a second admin’s approval (four-eye, per CLAUDE.md inviolable). Every step is audit-chained.',
    sw: 'Wateja wamefungwa kwa mamlaka yao ya kujisajili. Ni msimamizi wa ndani wa Borjie pekee anayeweza kubadilisha — na mabadiliko yanahitaji idhini ya msimamizi wa pili (macho-manne, kwa mujibu wa CLAUDE.md isiyobadilika). Kila hatua imewekwa kwenye mnyororo wa ukaguzi.',
  },
} as const;

/**
 * /tenants/:id/jurisdiction — JC-8 Borjie internal-admin jurisdiction
 * override surface.
 *
 * Renders:
 *   - Current jurisdiction snapshot (country code + locked-at + locked-by)
 *   - Propose change form (target country dropdown + reason + verifiedWith)
 *   - Pending proposals + four-eye approval queue
 *   - Decision history (approved + rejected)
 *
 * This is the human-facing counterpart to the JC-7
 * `/api/v1/admin/tenants/:id/jurisdiction` route. Tenants CANNOT
 * self-change their jurisdiction — only Borjie internal admin can,
 * and only via the four-eye flow surfaced here.
 *
 * SINGLE LANGUAGE PER LOCALE (canon): the locale is resolved server-side
 * from the `borjie_locale` cookie; the header renders in that one language
 * and the same value seeds the panel via `initialLocale` so SSR and the
 * first client paint agree (no EN-under-SW first-paint split-brain).
 */
export default async function TenantJurisdictionPage({
  params,
}: {
  // Next.js 15: route params are async (a Promise) and must be awaited.
  readonly params: Promise<{ readonly id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const locale = await readLocaleFromServerCookies();
  return (
    <QueryProvider>
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div>
            <p className="font-mono text-tiny uppercase tracking-widest text-signal-500">
              {pickByLocale(locale, STRINGS.eyebrow)}
            </p>
            <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
              {pickByLocale(locale, STRINGS.title)}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {pickByLocale(locale, STRINGS.body)}
            </p>
          </div>
        </header>

        <TenantJurisdictionPanel tenantId={id} initialLocale={locale} />
      </div>
    </QueryProvider>
  );
}
