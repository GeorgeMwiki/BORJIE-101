'use client';

import { useMemo, useState } from 'react';
import { SimpleTabs, type TabItem } from '@borjie/design-system';
import { PowersPanel } from './PowersPanel';
import { RoutingPanel } from './RoutingPanel';
import { ModelCatalogTable } from './ModelCatalogTable';
import { AiSuggestPanel } from './AiSuggestPanel';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

type TabId = 'powers' | 'routing' | 'catalog' | 'suggest';

const S = {
  powers: { en: 'Powers', sw: 'Mamlaka' },
  routing: { en: 'LLM routing', sw: 'Uelekezaji wa LLM' },
  catalog: { en: 'Model catalog', sw: 'Katalogi ya miundo' },
  suggest: { en: 'AI suggest', sw: 'Pendekezo la AI' },
} as const;

/**
 * Control-plane shell — tabs across the four admin-set knobs. Holds the seed
 * bridge so an applied AI-suggest proposal flows into the routing draft (the
 * admin still saves it via PUT — review-then-apply, never auto).
 */
export function ControlPlane({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const [tab, setTab] = useState<TabId>('powers');
  const [seededPerUseCase, setSeededPerUseCase] = useState<Readonly<
    Record<string, string>
  > | null>(null);
  const [seedNonce, setSeedNonce] = useState(0);

  function applySuggestion(perUseCase: Readonly<Record<string, string>>) {
    setSeededPerUseCase(perUseCase);
    setSeedNonce((n) => n + 1);
    setTab('routing');
  }

  const tabs = useMemo<TabItem[]>(
    () => [
      { id: 'powers', label: pickByLocale(locale, S.powers), content: <PowersPanel initialLocale={locale} /> },
      {
        id: 'routing',
        label: pickByLocale(locale, S.routing),
        content: (
          <RoutingPanel
            seededPerUseCase={seededPerUseCase}
            seedNonce={seedNonce}
            initialLocale={locale}
          />
        ),
      },
      { id: 'catalog', label: pickByLocale(locale, S.catalog), content: <ModelCatalogTable initialLocale={locale} /> },
      { id: 'suggest', label: pickByLocale(locale, S.suggest), content: <AiSuggestPanel onApply={applySuggestion} initialLocale={locale} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, seededPerUseCase, seedNonce],
  );

  return (
    <SimpleTabs
      tabs={tabs}
      value={tab}
      onChange={(v) => setTab(v as TabId)}
      variant="underline"
      contentClassName="pt-6"
    />
  );
}
