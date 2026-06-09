'use client';

import { useState } from 'react';
import { PowersPanel } from './PowersPanel';
import { RoutingPanel } from './RoutingPanel';
import { ModelCatalogTable } from './ModelCatalogTable';
import { AiSuggestPanel } from './AiSuggestPanel';

type TabId = 'powers' | 'routing' | 'catalog' | 'suggest';

const TABS: ReadonlyArray<{ readonly id: TabId; readonly label: string }> = [
  { id: 'powers', label: 'Powers' },
  { id: 'routing', label: 'LLM routing' },
  { id: 'catalog', label: 'Model catalog' },
  { id: 'suggest', label: 'AI suggest' },
];

/**
 * Control-plane shell — tabs across the four admin-set knobs. Holds the seed
 * bridge so an applied AI-suggest proposal flows into the routing draft (the
 * admin still saves it via PUT — review-then-apply, never auto).
 */
export function ControlPlane(): JSX.Element {
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

  return (
    <div className="space-y-6">
      <nav
        aria-label="Control plane sections"
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
              tab === t.id
                ? 'border-signal-500 text-foreground'
                : 'border-transparent text-neutral-400 hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'powers' ? <PowersPanel /> : null}
      {tab === 'routing' ? (
        <RoutingPanel seededPerUseCase={seededPerUseCase} seedNonce={seedNonce} />
      ) : null}
      {tab === 'catalog' ? <ModelCatalogTable /> : null}
      {tab === 'suggest' ? <AiSuggestPanel onApply={applySuggestion} /> : null}
    </div>
  );
}
