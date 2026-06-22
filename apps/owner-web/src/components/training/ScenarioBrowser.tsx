'use client';

/**
 * <ScenarioBrowser> — filterable catalog of mining rehearsal scenarios.
 *
 * Backs /training/scenarios (gap 9). Fetches the tenant's active scenario
 * templates from the gateway via the native `training-gateway` fetch layer,
 * lets the operator filter by difficulty / kind / competency (concept), and
 * hands a chosen scenario up to the workspace.
 *
 * HONEST-DEGRADE: scenario content is NEVER fabricated. A 503 surfaces as a
 * thrown TrainingGatewayError (graceful "service unavailable"); a 200 with
 * `degraded: true` (no catalog concept resolved) surfaces as an empty state
 * with a "generate from catalog" action that re-fetches.
 *
 * Owner-web dark-theme house style: slate/surface cards, signal-500 accent,
 * rounded-2xl panels, rounded-full buttons. All copy resolves through
 * `trainingT` (zero Swahili literals in this file).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Clock,
  Target,
  Play,
  Filter,
  GraduationCap,
  ServerCrash,
  Sparkles,
} from 'lucide-react';
import type { ScenarioView, ScenarioLanguage } from '@borjie/api-client/training-types';
import {
  Button,
  Skeleton,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@borjie/design-system';
import {
  listScenarios,
  generateScenarios,
  TrainingGatewayError,
} from './training-gateway';
import {
  trainingT,
  SCENARIO_DIFFICULTIES,
  SCENARIO_KINDS,
} from '@/i18n/strings/training';
import { difficultyChipClass } from './training-scoring';

interface ScenarioBrowserProps {
  readonly locale: ScenarioLanguage;
  readonly onSelect: (scenario: ScenarioView) => void;
  /**
   * Admin deep-link role-mode lock, surfaced as a banner. `null` when no
   * role-mode was deep-linked.
   */
  readonly lockedRoleModeLabel: string | null;
}

type DifficultyFilter = 'all' | string;
type KindFilter = 'all' | string;
type ConceptFilter = 'all' | string;

export function ScenarioBrowser({
  locale,
  onSelect,
  lockedRoleModeLabel,
}: ScenarioBrowserProps) {
  const tr = trainingT(locale);
  const [scenarios, setScenarios] = useState<readonly ScenarioView[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateFailed, setGenerateFailed] = useState(false);

  const [difficulty, setDifficulty] = useState<DifficultyFilter>('all');
  const [kind, setKind] = useState<KindFilter>('all');
  const [concept, setConcept] = useState<ConceptFilter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setErrorStatus(null);
    try {
      const result = await listScenarios(locale);
      setScenarios(result.scenarios);
      setDegraded(result.degraded);
    } catch (err) {
      const status = err instanceof TrainingGatewayError ? err.status : 0;
      setErrorStatus(status);
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const onGenerate = useCallback(async () => {
    setGenerating(true);
    setGenerateFailed(false);
    try {
      const result = await generateScenarios(locale);
      setScenarios(result.scenarios);
      setDegraded(result.degraded);
    } catch {
      setGenerateFailed(true);
    } finally {
      setGenerating(false);
    }
  }, [locale]);

  // Concept pool for the competency filter — the union of every scenario's
  // grounded concept ids (real, never invented).
  const conceptIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of scenarios) for (const id of s.conceptIds) set.add(id);
    return [...set].sort();
  }, [scenarios]);

  const filtered = useMemo(
    () =>
      scenarios.filter((s) => {
        if (difficulty !== 'all' && s.difficulty !== difficulty) return false;
        if (kind !== 'all' && s.kind !== kind) return false;
        if (concept !== 'all' && !s.conceptIds.includes(concept)) return false;
        return true;
      }),
    [scenarios, difficulty, kind, concept],
  );

  if (loading) {
    return <BrowserSkeleton />;
  }

  // 503 / network: the gateway honest-degrades with a typed error. Show a
  // recoverable state — never a fabricated scenario.
  if (errorStatus !== null) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning">
        <ServerCrash className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span>{errorStatus === 503 ? tr.t('errorUnavailable') : tr.t('errorLoad')}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          className="ml-auto"
        >
          {tr.t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {lockedRoleModeLabel ? (
        <div className="rounded-2xl border border-signal-500/40 bg-signal-500/10 px-4 py-3 text-sm text-signal-300">
          {tr.tp('roleModeLockedBanner', { role: lockedRoleModeLabel })}
        </div>
      ) : null}

      <Filters
        locale={locale}
        difficulty={difficulty}
        kind={kind}
        concept={concept}
        conceptIds={conceptIds}
        onDifficulty={setDifficulty}
        onKind={setKind}
        onConcept={setConcept}
      />

      {filtered.length === 0 ? (
        <ScenarioEmptyState
          locale={locale}
          degraded={degraded}
          generating={generating}
          onGenerate={() => void onGenerate()}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" role="list">
          {filtered.map((scenario) => (
            <li key={scenario.id}>
              <ScenarioCard scenario={scenario} locale={locale} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}

      {generateFailed ? (
        <div className="rounded-2xl border border-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning">
          {tr.t('generateFailed')}
        </div>
      ) : null}
    </div>
  );
}

interface FiltersProps {
  readonly locale: ScenarioLanguage;
  readonly difficulty: DifficultyFilter;
  readonly kind: KindFilter;
  readonly concept: ConceptFilter;
  readonly conceptIds: readonly string[];
  readonly onDifficulty: (v: DifficultyFilter) => void;
  readonly onKind: (v: KindFilter) => void;
  readonly onConcept: (v: ConceptFilter) => void;
}

function Filters({
  locale,
  difficulty,
  kind,
  concept,
  conceptIds,
  onDifficulty,
  onKind,
  onConcept,
}: FiltersProps) {
  const tr = trainingT(locale);
  return (
    <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-border bg-surface/40 p-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Filter className="h-4 w-4" aria-hidden="true" />
        <span className="font-medium text-muted-foreground">{tr.t('filters')}</span>
      </div>

      <SelectField
        id="filter-difficulty"
        label={tr.t('difficulty')}
        value={difficulty}
        onChange={onDifficulty}
        options={[
          { value: 'all', label: tr.t('all') },
          ...SCENARIO_DIFFICULTIES.map((d) => ({ value: d, label: tr.difficultyLabel(d) })),
        ]}
      />

      <SelectField
        id="filter-kind"
        label={tr.t('kind')}
        value={kind}
        onChange={onKind}
        options={[
          { value: 'all', label: tr.t('all') },
          ...SCENARIO_KINDS.map((k) => ({ value: k, label: tr.kindLabel(k) })),
        ]}
      />

      <SelectField
        id="filter-concept"
        label={tr.t('competency')}
        value={concept}
        onChange={onConcept}
        disabled={conceptIds.length === 0}
        options={[
          { value: 'all', label: tr.t('all') },
          ...conceptIds.map((id) => ({ value: id, label: id })),
        ]}
      />
    </div>
  );
}

interface SelectFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly disabled?: boolean;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
}

function SelectField({ id, label, value, onChange, disabled, options }: SelectFieldProps) {
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <label htmlFor={id} className="font-medium text-muted-foreground">
        {label}
      </label>
      <Select value={value} onValueChange={onChange} {...(disabled !== undefined ? { disabled } : {})}>
        <SelectTrigger id={id} className="min-w-[10rem]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface ScenarioCardProps {
  readonly scenario: ScenarioView;
  readonly locale: ScenarioLanguage;
  readonly onSelect: (scenario: ScenarioView) => void;
}

function ScenarioCard({ scenario, locale, onSelect }: ScenarioCardProps) {
  const tr = trainingT(locale);
  const title = locale === 'sw' && scenario.titleSw ? scenario.titleSw : scenario.title;
  const summary =
    locale === 'sw' && scenario.summarySw ? scenario.summarySw : scenario.summary;
  const objectives = scenario.briefing.objectives?.length ?? 0;

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-surface/40 p-4 transition-colors hover:border-signal-500/40">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-signal-500/10 p-2">
          <GraduationCap className="h-5 w-5 text-signal-400" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">{tr.kindLabel(scenario.kind)}</p>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-tiny font-medium ${difficultyChipClass(
            scenario.difficulty,
          )}`}
        >
          {tr.difficultyLabel(scenario.difficulty)}
        </span>
      </div>

      <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{summary}</p>

      <dl className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          <dt className="sr-only">{tr.t('estMinutes')}</dt>
          <dd className="tabular-nums">{scenario.estimatedMinutes}</dd>
        </div>
        <div className="flex items-center gap-1">
          <Target className="h-3.5 w-3.5" aria-hidden="true" />
          <dt className="sr-only">{tr.t('objectivesLabel')}</dt>
          <dd className="tabular-nums">{objectives}</dd>
        </div>
      </dl>

      <Button
        type="button"
        size="sm"
        onClick={() => onSelect(scenario)}
        className="mt-4 gap-1.5"
      >
        <Play className="h-4 w-4" aria-hidden="true" />
        {tr.t('startScenario')}
      </Button>
    </div>
  );
}

function BrowserSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Skeleton className="h-14 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-48 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

/**
 * Empty state — two shapes:
 *   - `degraded` (backend resolved no catalog concept): offer a "generate"
 *     action that re-fetches.
 *   - filtered-out: a passive "no match" state with no action.
 */
function ScenarioEmptyState({
  locale,
  degraded,
  generating,
  onGenerate,
}: {
  readonly locale: ScenarioLanguage;
  readonly degraded: boolean;
  readonly generating: boolean;
  readonly onGenerate: () => void;
}) {
  const tr = trainingT(locale);
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-surface/40 px-6 py-12 text-center">
      <GraduationCap className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-base font-semibold text-foreground">
        {degraded ? tr.t('emptyDegradedTitle') : tr.t('emptyTitle')}
      </h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        {degraded ? tr.t('emptyDegradedDesc') : tr.t('emptyDesc')}
      </p>
      {degraded ? (
        <Button
          type="button"
          size="sm"
          onClick={onGenerate}
          disabled={generating}
          className="mt-5 gap-2"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          {generating ? tr.t('loading') : tr.t('generate')}
        </Button>
      ) : null}
    </div>
  );
}
