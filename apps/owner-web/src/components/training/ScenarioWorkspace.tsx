'use client';

/**
 * <ScenarioWorkspace> — one interactive rehearsal run (gap 9).
 *
 * Backs /training/scenarios once a scenario is chosen. Three phases driven by
 * the training-mode context:
 *   1. briefing  — counterparty + situation + objectives (grounded, read-only)
 *   2. active    — messaging transcript; each learner turn returns a grounded
 *                  counterparty reply + objective-coverage; a decision-capture
 *                  timer runs throughout
 *   3. complete  — score + pass/fail, scored from coverage + timing
 *
 * The counterparty reply is produced server-side from the scenario briefing
 * (never free-hand). Errors (incl. 503 / 403 role-mode) surface inline.
 * Owner-web dark-theme house style; all copy via `trainingT`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock,
  Send,
  Target,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Flag,
  ShieldCheck,
} from 'lucide-react';
import type { ScenarioView, ScenarioRoleMode, ScenarioLanguage } from '@borjie/api-client/training-types';
import { trainingT } from '@/i18n/strings/training';
import { useTraining } from './training-mode-context';
import { computeRunScore, formatElapsed } from './training-scoring';

interface ScenarioWorkspaceProps {
  readonly scenario: ScenarioView;
  readonly roleMode: ScenarioRoleMode | null;
  readonly locale: ScenarioLanguage;
  readonly onExit: () => void;
}

export function ScenarioWorkspace({
  scenario,
  roleMode,
  locale,
  onExit,
}: ScenarioWorkspaceProps) {
  const tr = trainingT(locale);
  const { state, start, send, complete } = useTraining();
  const [input, setInput] = useState('');
  const startedRef = useRef(false);

  // Begin the run once on mount (role-mode validated server-side).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start(scenario, roleMode);
  }, [scenario, roleMode, start]);

  const title = locale === 'sw' && scenario.titleSw ? scenario.titleSw : scenario.title;
  const objectivesTotal = state.objectivesTotal || (scenario.briefing.objectives?.length ?? 0);
  const coveragePct =
    objectivesTotal > 0 ? Math.round((state.objectivesCovered / objectivesTotal) * 100) : 0;
  const allCovered = objectivesTotal > 0 && state.objectivesCovered >= objectivesTotal;

  const handleSend = () => {
    const text = input.trim();
    if (!text || state.isSending) return;
    setInput('');
    void send(text);
  };

  const handleComplete = () => {
    const score = computeRunScore(
      state.objectivesCovered,
      objectivesTotal,
      state.elapsedMs,
      scenario.estimatedMinutes,
    );
    void complete(score);
  };

  // Role-mode lock rejected by the server (403) — surface a recoverable state.
  if (state.errorStatus === 403) {
    return (
      <WorkspaceError
        title={tr.t('roleModeRejectedTitle')}
        message={state.error ?? tr.t('roleModeRejectedDesc')}
        onExit={onExit}
        exitLabel={tr.t('backToBrowser')}
      />
    );
  }
  if (state.errorStatus === 503) {
    return (
      <WorkspaceError
        title={tr.t('errorUnavailable')}
        message={tr.t('errorUnavailableDesc')}
        onExit={onExit}
        exitLabel={tr.t('backToBrowser')}
      />
    );
  }

  if (state.phase === 'complete') {
    return (
      <RunResult
        locale={locale}
        passed={state.passed ?? false}
        score={state.score ?? 0}
        objectivesCovered={state.objectivesCovered}
        objectivesTotal={objectivesTotal}
        onExit={onExit}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface/40 p-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onExit}
            aria-label={tr.t('backToBrowser')}
            className="rounded-full border border-border bg-surface px-2.5 py-2 text-neutral-400 hover:bg-surface/60"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-neutral-500">{tr.kindLabel(scenario.kind)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {state.roleMode ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-signal-500/40 bg-signal-500/10 px-2 py-0.5 text-tiny font-medium text-signal-300">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              {tr.roleLabel(state.roleMode)}
            </span>
          ) : null}
          <div
            className="flex items-center gap-1.5 text-sm text-neutral-300"
            aria-label={tr.t('elapsedTime')}
          >
            <Clock className="h-4 w-4" aria-hidden="true" />
            <span className="font-mono tabular-nums">{formatElapsed(state.elapsedMs)}</span>
            <span className="text-xs text-neutral-600">/ {scenario.estimatedMinutes}:00</span>
          </div>
        </div>
      </header>

      {objectivesTotal > 0 ? (
        <section
          aria-label={tr.t('objectiveCoverage')}
          className="rounded-2xl border border-border bg-surface/40 p-4"
        >
          <div className="mb-2 flex items-center justify-between text-xs text-neutral-400">
            <span className="flex items-center gap-1.5 font-medium">
              <Target className="h-3.5 w-3.5" aria-hidden="true" />
              {tr.t('objectiveCoverage')}
            </span>
            <span className="tabular-nums">
              {state.objectivesCovered}/{objectivesTotal}
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-slate-800"
            role="progressbar"
            aria-valuenow={coveragePct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-signal-500 transition-all"
              style={{ width: `${coveragePct}%` }}
            />
          </div>
        </section>
      ) : null}

      {state.isStarting ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-surface/40 p-8 text-sm text-neutral-500">
          {tr.t('startingRun')}
        </div>
      ) : (
        <Briefing scenario={scenario} locale={locale} />
      )}

      {state.phase === 'active' ? <Transcript scenario={scenario} locale={locale} /> : null}

      {state.error && state.errorStatus !== 403 ? (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          {state.error}
        </div>
      ) : null}

      {state.phase === 'active' ? (
        <Composer
          locale={locale}
          input={input}
          disabled={state.isSending}
          onChange={setInput}
          onSend={handleSend}
          onComplete={handleComplete}
          canComplete={state.transcript.length > 0}
          highlightComplete={allCovered}
        />
      ) : null}
    </div>
  );
}

function Briefing({
  scenario,
  locale,
}: {
  readonly scenario: ScenarioView;
  readonly locale: ScenarioLanguage;
}) {
  const tr = trainingT(locale);
  const b = scenario.briefing;
  const counterparty = locale === 'sw' ? b.counterpartySw ?? b.counterpartyEn : b.counterpartyEn;
  const situation = locale === 'sw' ? b.situationSw ?? b.situationEn : b.situationEn;
  const objectives = b.objectives ?? [];

  return (
    <section className="rounded-2xl border border-border bg-surface/40 p-4">
      <h3 className="text-sm font-semibold text-foreground">{tr.t('briefingTitle')}</h3>
      {counterparty ? (
        <p className="mt-2 text-sm text-neutral-300">
          <span className="font-medium text-foreground">{tr.t('counterparty')}: </span>
          {counterparty}
        </p>
      ) : null}
      {situation ? <p className="mt-2 text-sm text-neutral-400">{situation}</p> : null}
      {objectives.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
            {tr.t('objectivesLabel')}
          </p>
          <ul className="space-y-1.5" role="list">
            {objectives.map((o) => (
              <li key={o.conceptId} className="flex items-start gap-2 text-sm text-neutral-300">
                <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-400" aria-hidden="true" />
                <span>{locale === 'sw' ? o.sw : o.en}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Transcript({
  scenario,
  locale,
}: {
  readonly scenario: ScenarioView;
  readonly locale: ScenarioLanguage;
}) {
  const tr = trainingT(locale);
  const { state } = useTraining();
  const scrollRef = useRef<HTMLDivElement>(null);
  const counterpartyName = useMemo(() => {
    const b = scenario.briefing;
    return locale === 'sw' ? b.counterpartySw ?? b.counterpartyEn : b.counterpartyEn;
  }, [scenario.briefing, locale]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [state.transcript, state.isSending]);

  return (
    <div
      ref={scrollRef}
      className="flex max-h-[24rem] flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-slate-950/40 p-4"
      role="log"
      aria-label={tr.t('transcript')}
      aria-live="polite"
    >
      {state.transcript.length === 0 ? (
        <p className="py-6 text-center text-sm text-neutral-600">{tr.t('transcriptEmpty')}</p>
      ) : null}
      {state.transcript.map((turn) => (
        <div key={turn.id} className="flex flex-col gap-2">
          <div className="max-w-[85%] self-end rounded-2xl rounded-br-sm bg-signal-500 px-3 py-2 text-sm text-background">
            {turn.learner}
          </div>
          {turn.reply ? (
            <div className="max-w-[85%] self-start">
              <p className="mb-0.5 pl-1 text-tiny text-neutral-500">{counterpartyName}</p>
              <div className="rounded-2xl rounded-bl-sm border border-border bg-surface px-3 py-2 text-sm text-foreground">
                {locale === 'sw' ? turn.reply.sw : turn.reply.en}
              </div>
            </div>
          ) : null}
        </div>
      ))}
      {state.isSending ? (
        <div className="flex items-center gap-2 pl-1 text-xs text-neutral-500">
          {tr.t('counterpartyTyping')}
        </div>
      ) : null}
    </div>
  );
}

interface ComposerProps {
  readonly locale: ScenarioLanguage;
  readonly input: string;
  readonly disabled: boolean;
  readonly onChange: (v: string) => void;
  readonly onSend: () => void;
  readonly onComplete: () => void;
  readonly canComplete: boolean;
  readonly highlightComplete: boolean;
}

function Composer({
  locale,
  input,
  disabled,
  onChange,
  onSend,
  onComplete,
  canComplete,
  highlightComplete,
}: ComposerProps) {
  const tr = trainingT(locale);
  return (
    <div className="rounded-2xl border border-border bg-surface/40 p-3">
      <label htmlFor="scenario-input" className="sr-only">
        {tr.t('inputLabel')}
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id="scenario-input"
          value={input}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          rows={2}
          placeholder={tr.t('inputPlaceholder')}
          className="flex-1 resize-none rounded-xl border border-border bg-slate-950/40 px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={disabled || !input.trim()}
          className="inline-flex items-center gap-1.5 rounded-full bg-signal-500 px-4 py-2.5 text-xs font-semibold text-background hover:bg-signal-400 disabled:opacity-50"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {tr.t('send')}
        </button>
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onComplete}
          disabled={!canComplete}
          className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold disabled:opacity-50 ${
            highlightComplete
              ? 'bg-signal-500 text-background hover:bg-signal-400'
              : 'border border-border bg-surface text-foreground hover:bg-surface/60'
          }`}
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {tr.t('completeRun')}
        </button>
      </div>
    </div>
  );
}

function RunResult({
  locale,
  passed,
  score,
  objectivesCovered,
  objectivesTotal,
  onExit,
}: {
  readonly locale: ScenarioLanguage;
  readonly passed: boolean;
  readonly score: number;
  readonly objectivesCovered: number;
  readonly objectivesTotal: number;
  readonly onExit: () => void;
}) {
  const tr = trainingT(locale);
  const pct = Math.round(score * 100);
  return (
    <div
      className="flex flex-col items-center justify-center rounded-2xl border border-border bg-surface/40 px-6 py-12 text-center"
      data-testid="scenario-result"
    >
      <div
        className={`mb-4 flex h-16 w-16 items-center justify-center rounded-full ${
          passed ? 'bg-emerald-950/40' : 'bg-warning/10'
        }`}
      >
        {passed ? (
          <CheckCircle2 className="h-8 w-8 text-emerald-400" aria-hidden="true" />
        ) : (
          <XCircle className="h-8 w-8 text-warning" aria-hidden="true" />
        )}
      </div>
      <h2 className="text-xl font-bold text-foreground">
        {passed ? tr.t('runPassedTitle') : tr.t('runMissedTitle')}
      </h2>
      <p className="mt-1.5 text-sm text-neutral-400">
        <span className="tabular-nums">{pct}%</span> · {objectivesCovered}/{objectivesTotal}
      </p>
      <button
        type="button"
        onClick={onExit}
        className="mt-6 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400"
      >
        {tr.t('backToBrowser')}
      </button>
    </div>
  );
}

function WorkspaceError({
  title,
  message,
  onExit,
  exitLabel,
}: {
  readonly title: string;
  readonly message: string;
  readonly onExit: () => void;
  readonly exitLabel: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-warning/40 bg-warning/10 px-6 py-12 text-center">
      <XCircle className="mb-3 h-10 w-10 text-warning" aria-hidden="true" />
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-1.5 max-w-md text-sm text-neutral-400">{message}</p>
      <button
        type="button"
        onClick={onExit}
        className="mt-6 rounded-full border border-border bg-surface px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface/60"
      >
        {exitLabel}
      </button>
    </div>
  );
}
