'use client';

import { useState } from 'react';
import { Button } from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { Toast } from '../Toast';
import { useAiSuggest } from '@/lib/internal/control-plane/queries';
import type {
  AiSuggestResult,
  UseCaseSuggestion,
} from '@/lib/internal/control-plane/api';

interface AiSuggestPanelProps {
  /** Hand the accepted per-use-case map up so the routing draft can seed it. */
  readonly onApply: (perUseCase: Readonly<Record<string, string>>) => void;
}

function buildPerUseCaseMap(
  suggestions: ReadonlyArray<UseCaseSuggestion>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    suggestions
      .filter((s) => !s.locked && s.recommended)
      .map((s) => [s.useCase, s.recommended]),
  );
}

/**
 * AI-SUGGEST — runs the suggest-only recommender (HITL). Renders the recommended
 * per-use-case routing with rationale + estimated cost / latency for the admin
 * to REVIEW. "Apply to routing draft" hands the map up to the routing panel; the
 * admin still saves it via PUT. This panel NEVER writes config itself.
 */
export function AiSuggestPanel({ onApply }: AiSuggestPanelProps): JSX.Element {
  const mutation = useAiSuggest();
  const [result, setResult] = useState<AiSuggestResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function run() {
    mutation.mutate(
      {},
      {
        onSuccess: (data) => {
          setResult(data);
          setToast(`Recommender produced ${data.perUseCase.length} suggestions — review below.`);
        },
        onError: (err) => setToast(`Failed: ${err.message}`),
      },
    );
  }

  const suggestions = result?.perUseCase ?? [];
  const applicable = buildPerUseCaseMap(suggestions);
  const applicableCount = Object.keys(applicable).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs text-neutral-400">
          The recommender proposes the optimal model per use-case from the catalog
          (cost / capability / latency weighted). It is suggest-only — review, then
          apply into the routing draft and save it there.
        </p>
        <Button
          type="button"
          disabled={mutation.isPending}
          onClick={run}
          className="bg-signal-500/15 text-signal-500 hover:bg-signal-500/25"
        >
          {mutation.isPending ? 'Running…' : 'Run recommender'}
        </Button>
      </div>

      {result ? (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-sunken">
                <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
                  <th className="px-4 py-3 font-medium">Use case</th>
                  <th className="px-4 py-3 font-medium">Recommended</th>
                  <th className="px-4 py-3 text-right font-medium">Est. cost / 1M</th>
                  <th className="px-4 py-3 text-right font-medium">Est. latency</th>
                  <th className="px-4 py-3 font-medium">Rationale</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => (
                  <tr key={s.useCase} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-neutral-300">
                      <div className="flex items-center gap-2">
                        {s.useCase}
                        {s.locked ? <StubBadge tone="danger">locked</StubBadge> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">
                      {s.recommended}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                      {typeof s.estimatedCostPerMillionUsd === 'number'
                        ? `$${s.estimatedCostPerMillionUsd.toFixed(2)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                      {typeof s.estimatedLatencyMs === 'number'
                        ? `${s.estimatedLatencyMs} ms`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-400">
                      {s.rationale ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={applicableCount === 0}
              onClick={() => {
                onApply(applicable);
                setToast(`Applied ${applicableCount} suggestions into the routing draft.`);
              }}
              className="border-signal-500/40 bg-signal-500/10 text-signal-500 hover:bg-signal-500/20 disabled:opacity-40"
            >
              Apply {applicableCount} into routing draft
            </Button>
            <StubBadge tone="info">Review-then-apply · never auto-applies</StubBadge>
          </div>
        </div>
      ) : null}

      <Toast
        message={toast}
        tone={mutation.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
