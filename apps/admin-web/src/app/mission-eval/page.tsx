/**
 * Mission-eval admin page — Wave-K portal-parity.
 *
 * Server component shell. The interactive table + drawer lives in the
 * sibling client component, which fetches from
 * `/api/v1/parity/capability/dashboard`.
 *
 * Mirrors the reference admin mission-eval composition. The "Run
 * audit" button is a future affordance — this
 * surface is read-only on first ship.
 */

import { PageShell } from '@/components/migrated/PageShell';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { MissionEvalClient } from './MissionEvalClient';

export const dynamic = 'force-dynamic';

// Header copy resolved server-side from the locale cookie so SSR and the
// client's first paint render the same language (zero-mix canon).
const HEADER = {
  title: { en: 'Mission-eval', sw: 'Tathmini ya dhamira' },
  subtitle: {
    en: 'Eval runs, captured CoT, judge scores, and re-judge actions across the mining-estate capability surface.',
    sw: 'Miendo ya tathmini, CoT iliyonaswa, alama za jaji, na vitendo vya kuhukumu upya katika uso wa uwezo wa shamba la madini.',
  },
} as const;

export default async function MissionEvalPage() {
  const locale = await readLocaleFromServerCookies();
  return (
    <PageShell
      title={pickByLocale(locale, HEADER.title)}
      subtitle={pickByLocale(locale, HEADER.subtitle)}
    >
      <MissionEvalClient initialLocale={locale} />
    </PageShell>
  );
}
