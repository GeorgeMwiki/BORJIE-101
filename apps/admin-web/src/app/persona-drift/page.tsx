import { PageShell } from '@/components/migrated/PageShell';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { PersonaDriftClient } from './PersonaDriftClient';

// Header copy resolved server-side from the locale cookie so SSR and the
// client's first paint render the same language (zero-mix canon).
const HEADER = {
  title: { en: 'Persona drift', sw: 'Mwelekeo wa mhusika' },
  subtitle: {
    en: 'Cron-detected voice-consistency breaches across personas. 24-dim probe; per-day rollup.',
    sw: 'Ukiukaji wa uthabiti wa sauti uliogunduliwa na cron kwa wahusika. Uchunguzi wa vipimo 24; muhtasari kwa siku.',
  },
} as const;

/**
 * Persona-drift dashboard (Phase D D7).
 *
 * Surfaces the rows from `kernel_persona_drift_events` and renders a
 * chart of dim-breach counts over time. Reads only — alert creation
 * happens via the persona-drift cron supervisor in api-gateway.
 */
export default async function PersonaDriftPage() {
  const locale = await readLocaleFromServerCookies();
  return (
    <PageShell
      title={pickByLocale(locale, HEADER.title)}
      subtitle={pickByLocale(locale, HEADER.subtitle)}
    >
      <PersonaDriftClient initialLocale={locale} />
    </PageShell>
  );
}
