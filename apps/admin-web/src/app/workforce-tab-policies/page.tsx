import { PageShell } from '@/components/migrated/PageShell';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { WorkforceTabPoliciesClient } from './WorkforceTabPoliciesClient';

// Header copy resolved server-side from the locale cookie so SSR and the
// client's first paint render the same language (zero-mix canon).
const HEADER = {
  title: { en: 'Workforce tab policies', sw: 'Sera za vichupo vya wafanyakazi' },
  subtitle: {
    en: 'Cross-tenant distribution of enabled workforce tabs per role.',
    sw: 'Usambazaji wa vichupo vya wafanyakazi vilivyowezeshwa kwa kila jukumu katika wateja wote.',
  },
} as const;

/**
 * Borjie internal admin — workforce tab-policy fleet view.
 *
 * Wave WORKFORCE-FIXED-TABS. Cross-tenant read-only dashboard that
 * shows the distribution of enabled tabs per role across every tenant
 * in the fleet. Helps the Borjie team spot pilot tenants who have not
 * enabled enough tabs for their workers yet and reach out proactively.
 */
export default async function WorkforceTabPoliciesPage() {
  const locale = await readLocaleFromServerCookies();
  return (
    <PageShell
      title={pickByLocale(locale, HEADER.title)}
      subtitle={pickByLocale(locale, HEADER.subtitle)}
    >
      <WorkforceTabPoliciesClient initialLocale={locale} />
    </PageShell>
  );
}
