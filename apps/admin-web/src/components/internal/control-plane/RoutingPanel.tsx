'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  FormField,
  Input,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { Toast } from '../Toast';
import { ScopeSelector } from './ScopeSelector';
import { ModelSelect } from './ModelSelect';
import { useModelCatalogQuery, useRoutingQuery, useSetRouting } from '@/lib/internal/control-plane/queries';
import {
  COMBINE_STRATEGIES,
  type CatalogModel,
  type CombineStrategy,
  type EnsembleConfig,
  type Scope,
  type SetRoutingInput,
} from '@/lib/internal/control-plane/api';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { localizeApiError } from '@borjie/error-catalog';

interface RoutingPanelProps {
  /** Optional per-use-case map seeded from an applied AI-suggest proposal. */
  readonly seededPerUseCase?: Readonly<Record<string, string>> | null;
  /** Bumped by the parent each time a new suggestion is applied. */
  readonly seedNonce?: number;
  readonly initialLocale?: Locale;
}

interface DraftEnsemble {
  readonly enabled: boolean;
  readonly members: ReadonlyArray<string>;
  readonly combineStrategy: CombineStrategy;
  readonly judgeModel: string;
}

const EMPTY_ENSEMBLE: DraftEnsemble = {
  enabled: false,
  members: [],
  combineStrategy: 'first-wins',
  judgeModel: '',
};

const S = {
  lastSet: { en: 'Last set', sw: 'Imewekwa mwisho' },
  noConfig: {
    en: 'No config yet — falls back to task ladder',
    sw: 'Hakuna usanidi bado — hurudi kwenye ngazi ya kazi',
  },
  coreModel: { en: 'Core model', sw: 'Muundo wa msingi' },
  coreModelHint: {
    en: 'The primary model that answers when no per-use-case override matches.',
    sw: 'Muundo wa msingi unaojibu wakati hakuna ubatilishaji wa matumizi unaolingana.',
  },
  pickCore: { en: '— pick a core model —', sw: '— chagua muundo wa msingi —' },
  fallbackChain: { en: 'Fallback chain', sw: 'Mnyororo wa kurudi' },
  fallbackHint: {
    en: 'Tried in order when the core model is unavailable. Reorder with the arrows.',
    sw: 'Hujaribiwa kwa mpangilio wakati muundo wa msingi haupatikani. Panga upya kwa mishale.',
  },
  moveUp: { en: 'Move up', sw: 'Sogeza juu' },
  moveDown: { en: 'Move down', sw: 'Sogeza chini' },
  remove: { en: 'Remove', sw: 'Ondoa' },
  addFallback: { en: '— add fallback —', sw: '— ongeza ya kurudi —' },
  addFallbackAria: { en: 'Add fallback model', sw: 'Ongeza muundo wa kurudi' },
  add: { en: 'Add', sw: 'Ongeza' },
  ensemble: { en: 'Ensemble', sw: 'Mkusanyiko' },
  ensembleHint: {
    en: 'Run multiple models in parallel and combine. Cost-aware: N members = N x cost.',
    sw: 'Endesha miundo mingi kwa sambamba na uchanganye. Inazingatia gharama: wanachama N = gharama N.',
  },
  enabled: { en: 'Enabled', sw: 'Imewezeshwa' },
  members: { en: 'Members', sw: 'Wanachama' },
  costMultiplier: {
    en: 'members · ~{n}x cost multiplier.',
    sw: 'wanachama · kizidishi cha gharama ~{n}x.',
  },
  combineStrategy: { en: 'Combine strategy', sw: 'Mkakati wa kuchanganya' },
  judgeModel: { en: 'Judge model', sw: 'Muundo wa hakimu' },
  pickJudge: { en: '— pick a judge —', sw: '— chagua hakimu —' },
  perUseCase: { en: 'Per-use-case routing', sw: 'Uelekezaji kwa kila matumizi' },
  perUseCaseHint: {
    en: 'Override the core model for a specific use-case. Locked / sovereign use-cases are not listed — they stay pinned to their policy floor.',
    sw: 'Batilisha muundo wa msingi kwa matumizi mahususi. Matumizi yaliyofungwa / huru hayaorodheshwi — yanabaki kwenye sera yao ya msingi.',
  },
  colUseCase: { en: 'Use case', sw: 'Matumizi' },
  colModel: { en: 'Model', sw: 'Muundo' },
  useCore: { en: '— use core —', sw: '— tumia ya msingi —' },
  modelFor: { en: 'Model for', sw: 'Muundo kwa' },
  reasonLabel: { en: 'Reason (audited, required)', sw: 'Sababu (inakaguliwa, inahitajika)' },
  reasonPlaceholder: {
    en: 'Why are you changing routing?',
    sw: 'Kwa nini unabadilisha uelekezaji?',
  },
  saving: { en: 'Saving…', sw: 'Inahifadhi…' },
  save: { en: 'Save routing config', sw: 'Hifadhi usanidi wa uelekezaji' },
  pickCoreFirst: { en: 'Pick a core model first.', sw: 'Chagua muundo wa msingi kwanza.' },
  reasonRequired: {
    en: 'Enter a reason (≥ 8 chars) before saving routing.',
    sw: 'Weka sababu (≥ herufi 8) kabla ya kuhifadhi uelekezaji.',
  },
  saved: { en: 'Routing saved', sw: 'Uelekezaji umehifadhiwa' },
  audit: { en: 'audit', sw: 'ukaguzi' },
  droppedLocked: { en: 'dropped locked', sw: 'imeondoa zilizofungwa' },
  applied: {
    en: 'Applied recommendation into the per-use-case draft. Review + save.',
    sw: 'Pendekezo limewekwa kwenye rasimu ya matumizi. Kagua + hifadhi.',
  },
  failed: { en: 'Failed', sw: 'Imeshindwa' },
} as const;

function moveItem<T>(items: ReadonlyArray<T>, from: number, to: number): ReadonlyArray<T> {
  if (to < 0 || to >= items.length || from < 0 || from >= items.length) return items;
  const moved = items[from] as T;
  const without = items.filter((_, i) => i !== from);
  return [...without.slice(0, to), moved, ...without.slice(to)];
}

/**
 * LLM ROUTING — core-model picker, reorderable fallback chain, ensemble panel
 * (enable + members + combine-strategy + optional judge), and a per-use-case
 * routing table. Hydrates the current config from GET /llm-routing and writes
 * the whole document via PUT /llm-routing (the gateway re-validates + audits).
 */
export function RoutingPanel({
  seededPerUseCase,
  seedNonce,
  initialLocale,
}: RoutingPanelProps): JSX.Element {
  const locale = useLocale(initialLocale);
  const [scope, setScope] = useState<Scope>('global');
  const catalogQuery = useModelCatalogQuery();
  const routingQuery = useRoutingQuery(scope);
  const mutation = useSetRouting(scope);

  const [coreModel, setCoreModel] = useState('');
  const [fallbacks, setFallbacks] = useState<ReadonlyArray<string>>([]);
  const [newFallback, setNewFallback] = useState('');
  const [ensemble, setEnsemble] = useState<DraftEnsemble>(EMPTY_ENSEMBLE);
  const [perUseCase, setPerUseCase] = useState<Readonly<Record<string, string>>>({});
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const models: ReadonlyArray<CatalogModel> = catalogQuery.data?.models ?? [];
  const assignableUseCases = catalogQuery.data?.assignableUseCases ?? [];

  // Hydrate the draft from the persisted config whenever the scope's config loads.
  const loadedConfig = routingQuery.data?.config ?? null;
  const loadedScope = routingQuery.data?.scope;
  useEffect(() => {
    if (!loadedConfig) {
      setCoreModel('');
      setFallbacks([]);
      setEnsemble(EMPTY_ENSEMBLE);
      setPerUseCase({});
      return;
    }
    setCoreModel(loadedConfig.coreModel ?? '');
    setFallbacks(loadedConfig.orderedFallbacks ?? []);
    setEnsemble(
      loadedConfig.ensemble
        ? {
            enabled: loadedConfig.ensemble.enabled,
            members: loadedConfig.ensemble.members,
            combineStrategy: loadedConfig.ensemble.combineStrategy,
            judgeModel: loadedConfig.ensemble.judgeModel ?? '',
          }
        : EMPTY_ENSEMBLE,
    );
    setPerUseCase(loadedConfig.perUseCase ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedScope, JSON.stringify(loadedConfig)]);

  // Merge an applied AI-suggest proposal into the per-use-case draft.
  useEffect(() => {
    if (seededPerUseCase && Object.keys(seededPerUseCase).length > 0) {
      setPerUseCase((prev) => ({ ...prev, ...seededPerUseCase }));
      setToast(pickByLocale(locale, S.applied));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedNonce]);

  const reasonValid = reason.trim().length >= 8;
  const memberSet = new Set(ensemble.members);

  function toggleMember(model: string) {
    setEnsemble((prev) => ({
      ...prev,
      members: prev.members.includes(model)
        ? prev.members.filter((m) => m !== model)
        : [...prev.members, model],
    }));
  }

  function save() {
    if (!coreModel) {
      setToast(pickByLocale(locale, S.pickCoreFirst));
      return;
    }
    if (!reasonValid) {
      setToast(pickByLocale(locale, S.reasonRequired));
      return;
    }
    const cleanedUseCases = Object.fromEntries(
      Object.entries(perUseCase).filter(([, model]) => model.length > 0),
    );
    const payload: SetRoutingInput = {
      scope,
      reason: reason.trim(),
      coreModel,
      orderedFallbacks: [...fallbacks],
      ...(ensemble.enabled && ensemble.members.length > 0
        ? {
            ensemble: {
              enabled: ensemble.enabled,
              members: [...ensemble.members],
              combineStrategy: ensemble.combineStrategy,
              ...(ensemble.combineStrategy === 'judge-synthesis' && ensemble.judgeModel
                ? { judgeModel: ensemble.judgeModel }
                : {}),
            } satisfies EnsembleConfig,
          }
        : {}),
      ...(Object.keys(cleanedUseCases).length > 0 ? { perUseCase: cleanedUseCases } : {}),
    };
    mutation.mutate(payload, {
      onSuccess: (res) => {
        const dropped = res.droppedLockedUseCases?.length
          ? ` · ${pickByLocale(locale, S.droppedLocked)}: ${res.droppedLockedUseCases.join(', ')}`
          : '';
        setToast(
          `${pickByLocale(locale, S.saved)} (${res.scope})${
            res.journalId
              ? ` · ${pickByLocale(locale, S.audit)} ${res.journalId.slice(0, 8)}…`
              : ''
          }${dropped}`,
        );
      },
      onError: (err) => setToast(`${pickByLocale(locale, S.failed)}: ${err.message}`),
    });
  }

  if (catalogQuery.isError) {
    return <p className="text-sm text-danger">{localizeApiError(catalogQuery.error, locale)}</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ScopeSelector scope={scope} onChange={setScope} initialLocale={locale} />
        {routingQuery.data?.lastSetAt ? (
          <span className="text-xs text-muted-foreground">
            {pickByLocale(locale, S.lastSet)}{' '}
            {routingQuery.data.lastSetAt.replace('T', ' ').slice(0, 16)}
          </span>
        ) : (
          <StubBadge tone="neutral">{pickByLocale(locale, S.noConfig)}</StubBadge>
        )}
      </div>

      {/* Core model */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h3 className="mb-1 text-sm font-medium text-foreground">
          {pickByLocale(locale, S.coreModel)}
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          {pickByLocale(locale, S.coreModelHint)}
        </p>
        <ModelSelect
          value={coreModel}
          models={models}
          onChange={setCoreModel}
          allowEmpty
          emptyLabel={pickByLocale(locale, S.pickCore)}
          ariaLabel={pickByLocale(locale, S.coreModel)}
        />
      </section>

      {/* Ordered fallbacks */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h3 className="mb-1 text-sm font-medium text-foreground">
          {pickByLocale(locale, S.fallbackChain)}
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          {pickByLocale(locale, S.fallbackHint)}
        </p>
        <ol className="space-y-2">
          {fallbacks.map((model, idx) => (
            <li
              key={`${model}-${idx}`}
              className="flex items-center justify-between rounded-md border border-border bg-surface-sunken px-3 py-2"
            >
              <span className="font-mono text-xs text-muted-foreground">
                {idx + 1}. {model}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  aria-label={pickByLocale(locale, S.moveUp)}
                  disabled={idx === 0}
                  onClick={() => setFallbacks((prev) => moveItem(prev, idx, idx - 1))}
                  className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-surface disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={pickByLocale(locale, S.moveDown)}
                  disabled={idx === fallbacks.length - 1}
                  onClick={() => setFallbacks((prev) => moveItem(prev, idx, idx + 1))}
                  className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-surface disabled:opacity-40"
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={pickByLocale(locale, S.remove)}
                  onClick={() => setFallbacks((prev) => prev.filter((_, i) => i !== idx))}
                  className="rounded border border-border px-2 py-0.5 text-xs text-danger hover:bg-surface"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex items-center gap-2">
          <ModelSelect
            value={newFallback}
            models={models}
            onChange={setNewFallback}
            allowEmpty
            emptyLabel={pickByLocale(locale, S.addFallback)}
            ariaLabel={pickByLocale(locale, S.addFallbackAria)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!newFallback || fallbacks.includes(newFallback) || fallbacks.length >= 8}
            onClick={() => {
              setFallbacks((prev) => [...prev, newFallback]);
              setNewFallback('');
            }}
          >
            {pickByLocale(locale, S.add)}
          </Button>
        </div>
      </section>

      {/* Ensemble */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-foreground">
              {pickByLocale(locale, S.ensemble)}
            </h3>
            <p className="text-xs text-muted-foreground">
              {pickByLocale(locale, S.ensembleHint)}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={ensemble.enabled}
              onChange={(e) => setEnsemble((prev) => ({ ...prev, enabled: e.target.checked }))}
              className="size-4 accent-signal-500"
            />
            {pickByLocale(locale, S.enabled)}
          </label>
        </div>

        {ensemble.enabled ? (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                {pickByLocale(locale, S.members)}
              </p>
              <div className="flex flex-wrap gap-2">
                {models.map((m) => (
                  <button
                    key={m.model}
                    type="button"
                    onClick={() => toggleMember(m.model)}
                    className={`rounded-md border px-3 py-1.5 text-xs ${
                      memberSet.has(m.model)
                        ? 'border-signal-500 bg-signal-500/10 text-signal-500'
                        : 'border-border text-muted-foreground hover:bg-surface-sunken'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {ensemble.members.length > 1 ? (
                <p className="mt-2 text-xs text-warning">
                  {ensemble.members.length}{' '}
                  {pickByLocale(locale, S.costMultiplier).replace(
                    '{n}',
                    String(ensemble.members.length),
                  )}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">
                {pickByLocale(locale, S.combineStrategy)}
              </label>
              <select
                value={ensemble.combineStrategy}
                aria-label={pickByLocale(locale, S.combineStrategy)}
                onChange={(e) =>
                  setEnsemble((prev) => ({
                    ...prev,
                    combineStrategy: e.target.value as CombineStrategy,
                  }))
                }
                className="rounded-md border border-border bg-surface-sunken px-3 py-1.5 text-sm text-foreground focus:border-signal-500 focus:outline-none"
              >
                {(catalogQuery.data?.combineStrategies ?? COMBINE_STRATEGIES).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {ensemble.combineStrategy === 'judge-synthesis' ? (
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">
                  {pickByLocale(locale, S.judgeModel)}
                </label>
                <ModelSelect
                  value={ensemble.judgeModel}
                  models={models}
                  onChange={(judgeModel) => setEnsemble((prev) => ({ ...prev, judgeModel }))}
                  allowEmpty
                  emptyLabel={pickByLocale(locale, S.pickJudge)}
                  ariaLabel={pickByLocale(locale, S.judgeModel)}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Per-use-case routing table */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h3 className="mb-1 text-sm font-medium text-foreground">
          {pickByLocale(locale, S.perUseCase)}
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          {pickByLocale(locale, S.perUseCaseHint)}
        </p>
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pickByLocale(locale, S.colUseCase)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colModel)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignableUseCases.map((useCase) => (
                <TableRow key={useCase}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{useCase}</TableCell>
                  <TableCell>
                    <ModelSelect
                      value={perUseCase[useCase] ?? ''}
                      models={models}
                      onChange={(model) =>
                        setPerUseCase((prev) => {
                          const next = { ...prev };
                          if (model) next[useCase] = model;
                          else delete next[useCase];
                          return next;
                        })
                      }
                      allowEmpty
                      emptyLabel={pickByLocale(locale, S.useCore)}
                      ariaLabel={`${pickByLocale(locale, S.modelFor)} ${useCase}`}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Reason + save */}
      <section className="space-y-3">
        <FormField label={pickByLocale(locale, S.reasonLabel)} name="routing-reason">
          <Input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={pickByLocale(locale, S.reasonPlaceholder)}
            error={reason.length > 0 && !reasonValid}
          />
        </FormField>
        <Button type="button" loading={mutation.isPending} disabled={mutation.isPending} onClick={save}>
          {mutation.isPending ? pickByLocale(locale, S.saving) : pickByLocale(locale, S.save)}
        </Button>
      </section>

      <Toast
        message={toast}
        tone={mutation.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
