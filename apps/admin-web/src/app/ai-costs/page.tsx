import { PageShell } from '@/components/migrated/PageShell';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { AiCostsClient } from './AiCostsClient';

// Header copy resolved server-side from the locale cookie so SSR and the
// client's first paint render the same language (zero-mix canon).
const HEADER = {
  title: { en: 'AI spend', sw: 'Matumizi ya AI' },
  subtitle: {
    en: 'Monthly LLM cost across every Borjie surface, with monthly cap and per-model breakdown.',
    sw: 'Gharama ya LLM kwa mwezi katika kila uso wa Borjie, na kikomo cha mwezi na mchanganuo kwa kila modeli.',
  },
} as const;

export default async function AiCostsPage() {
  const locale = await readLocaleFromServerCookies();
  return (
    <PageShell
      title={pickByLocale(locale, HEADER.title)}
      subtitle={pickByLocale(locale, HEADER.subtitle)}
    >
      <AiCostsClient initialLocale={locale} />
    </PageShell>
  );
}
