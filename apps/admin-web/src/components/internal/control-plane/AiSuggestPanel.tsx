'use client';

import { useState } from 'react';
import {
  Button,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { Toast } from '../Toast';
import { useAiSuggest } from '@/lib/internal/control-plane/queries';
import type {
  AiSuggestResult,
  UseCaseSuggestion,
} from '@/lib/internal/control-plane/api';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

interface AiSuggestPanelProps {
  /** Hand the accepted per-use-case map up so the routing draft can seed it. */
  readonly onApply: (perUseCase: Readonly<Record<string, string>>) => void;
  readonly initialLocale?: Locale;
}

const S = {
  intro: {
    en: 'The recommender proposes the optimal model per use-case from the catalog (cost / capability / latency weighted). It is suggest-only — review, then apply into the routing draft and save it there.',
    sw: 'Mpendekezaji hupendekeza muundo bora kwa kila matumizi kutoka katalogi (gharama / uwezo / ucheleweshaji vimepimwa). Ni pendekezo tu — kagua, kisha weka kwenye rasimu ya uelekezaji na uihifadhi hapo.',
  },
  running: { en: 'Running…', sw: 'Inaendesha…' },
  run: { en: 'Run recommender', sw: 'Endesha mpendekezaji' },
  colUseCase: { en: 'Use case', sw: 'Matumizi' },
  colRecommended: { en: 'Recommended', sw: 'Iliyopendekezwa' },
  colCost: { en: 'Est. cost / 1M', sw: 'Gharama kadirio / 1M' },
  colLatency: { en: 'Est. latency', sw: 'Ucheleweshaji kadirio' },
  colRationale: { en: 'Rationale', sw: 'Sababu' },
  locked: { en: 'locked', sw: 'imefungwa' },
  applyInto: { en: 'into routing draft', sw: 'kwenye rasimu ya uelekezaji' },
  reviewThenApply: {
    en: 'Review-then-apply · never auto-applies',
    sw: 'Kagua-kisha-weka · haiwekwi kiotomatiki',
  },
  produced: { en: 'suggestions — review below.', sw: 'mapendekezo — kagua hapa chini.' },
  recommenderProduced: { en: 'Recommender produced', sw: 'Mpendekezaji umetoa' },
  appliedCount: {
    en: 'suggestions into the routing draft.',
    sw: 'mapendekezo kwenye rasimu ya uelekezaji.',
  },
  applied: { en: 'Applied', sw: 'Imeweka' },
  failed: { en: 'Failed', sw: 'Imeshindwa' },
} as const;

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
export function AiSuggestPanel({ onApply, initialLocale }: AiSuggestPanelProps): JSX.Element {
  const locale = useLocale(initialLocale);
  const mutation = useAiSuggest();
  const [result, setResult] = useState<AiSuggestResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function run() {
    mutation.mutate(
      {},
      {
        onSuccess: (data) => {
          setResult(data);
          setToast(
            `${pickByLocale(locale, S.recommenderProduced)} ${data.perUseCase.length} ${pickByLocale(locale, S.produced)}`,
          );
        },
        onError: (err) => setToast(`${pickByLocale(locale, S.failed)}: ${err.message}`),
      },
    );
  }

  const suggestions = result?.perUseCase ?? [];
  const applicable = buildPerUseCaseMap(suggestions);
  const applicableCount = Object.keys(applicable).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs text-muted-foreground">
          {pickByLocale(locale, S.intro)}
        </p>
        <Button type="button" disabled={mutation.isPending} loading={mutation.isPending} onClick={run}>
          {mutation.isPending ? pickByLocale(locale, S.running) : pickByLocale(locale, S.run)}
        </Button>
      </div>

      {result ? (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{pickByLocale(locale, S.colUseCase)}</TableHead>
                  <TableHead>{pickByLocale(locale, S.colRecommended)}</TableHead>
                  <TableHead className="text-right">{pickByLocale(locale, S.colCost)}</TableHead>
                  <TableHead className="text-right">{pickByLocale(locale, S.colLatency)}</TableHead>
                  <TableHead>{pickByLocale(locale, S.colRationale)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suggestions.map((s) => (
                  <TableRow key={s.useCase}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        {s.useCase}
                        {s.locked ? (
                          <StubBadge tone="danger">{pickByLocale(locale, S.locked)}</StubBadge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground">
                      {s.recommended}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {typeof s.estimatedCostPerMillionUsd === 'number'
                        ? `$${s.estimatedCostPerMillionUsd.toFixed(2)}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {typeof s.estimatedLatencyMs === 'number'
                        ? `${s.estimatedLatencyMs} ms`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.rationale ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={applicableCount === 0}
              onClick={() => {
                onApply(applicable);
                setToast(
                  `${pickByLocale(locale, S.applied)} ${applicableCount} ${pickByLocale(locale, S.appliedCount)}`,
                );
              }}
            >
              {pickByLocale(locale, S.applied)} {applicableCount}{' '}
              {pickByLocale(locale, S.applyInto)}
            </Button>
            <StubBadge tone="info">{pickByLocale(locale, S.reviewThenApply)}</StubBadge>
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
