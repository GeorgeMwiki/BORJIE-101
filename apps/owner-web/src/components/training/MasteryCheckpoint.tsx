'use client';

/**
 * <MasteryCheckpoint> — per-phase mastery challenge (gap 10).
 *
 * Backs /training/checkpoint. Questions are built SERVER-SIDE from the mining
 * concept catalog and returned already ordered weakest-concept first
 * (inverse-BKT). No hints, no reteach. The 0.7 pass threshold (returned by the
 * gateway) gates the next phase: passing unlocks it, missing routes the
 * operator back to the weak concepts.
 *
 * Deterministic + never fabricated: the component renders exactly the
 * questions the gateway returns and submits the per-concept results back so
 * learning_progress (BKT p_know) is updated. Owner-web dark-theme house style;
 * all copy via `trainingT`.
 */

import { useCallback, useState } from 'react';
import { Award, ArrowRight, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import type {
  CheckpointQuestion,
  CheckpointSubmitResult,
  ScenarioLanguage,
} from '@borjie/api-client/training-types';
import { Button } from '@borjie/design-system';
import { trainingT } from '@/i18n/strings/training';
import { submitCheckpoint, TrainingGatewayError } from './training-gateway';

const DEFAULT_PASS_THRESHOLD = 0.7;

interface MasteryCheckpointProps {
  readonly questions: readonly CheckpointQuestion[];
  /** Pass rate in [0, 1]; gateway returns 0.7. */
  readonly passThreshold?: number;
  readonly locale: ScenarioLanguage;
  /** Return to the training hub. */
  readonly onExit: () => void;
}

interface AnswerRecord {
  readonly conceptId: string;
  readonly correct: boolean;
}

type SubmitState =
  | { readonly status: 'idle' }
  | { readonly status: 'pending' }
  | { readonly status: 'error'; readonly httpStatus: number }
  | { readonly status: 'done'; readonly result: CheckpointSubmitResult };

export function MasteryCheckpoint({
  questions,
  passThreshold = DEFAULT_PASS_THRESHOLD,
  locale,
  onExit,
}: MasteryCheckpointProps) {
  const tr = trainingT(locale);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [answers, setAnswers] = useState<readonly AnswerRecord[]>([]);
  const [submit, setSubmit] = useState<SubmitState>({ status: 'idle' });

  const total = questions.length;
  const question = questions[idx];

  const runSubmit = useCallback(
    async (records: readonly AnswerRecord[]) => {
      setSubmit({ status: 'pending' });
      try {
        const result = await submitCheckpoint(
          [...new Set(records.map((r) => r.conceptId))],
          records.map((r) => ({ conceptId: r.conceptId, correct: r.correct })),
        );
        setSubmit({ status: 'done', result });
      } catch (err) {
        const httpStatus = err instanceof TrainingGatewayError ? err.status : 0;
        setSubmit({ status: 'error', httpStatus });
      }
    },
    [],
  );

  const advance = useCallback(() => {
    if (!picked || !question) return;
    const opt = question.options.find((o) => o.id === picked);
    if (!opt) return;
    const next: readonly AnswerRecord[] = [
      ...answers,
      { conceptId: question.conceptId, correct: opt.isCorrect },
    ];
    setAnswers(next);
    setPicked(null);
    if (idx + 1 >= total) {
      void runSubmit(next);
      return;
    }
    setIdx(idx + 1);
  }, [picked, question, answers, idx, total, runSubmit]);

  if (total === 0) {
    return (
      <CheckpointEmpty
        title={tr.t('checkpointEmptyTitle')}
        description={tr.t('checkpointEmptyDesc')}
        exitLabel={tr.t('backToHub')}
        onExit={onExit}
      />
    );
  }

  if (submit.status === 'done') {
    return (
      <CheckpointResult
        locale={locale}
        result={submit.result}
        passThreshold={submit.result.passThreshold ?? passThreshold}
        onExit={onExit}
        onRetry={() => {
          setIdx(0);
          setPicked(null);
          setAnswers([]);
          setSubmit({ status: 'idle' });
        }}
      />
    );
  }

  const progressPct = Math.round((idx / total) * 100);
  const isLast = idx + 1 >= total;
  const pending = submit.status === 'pending';

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <header className="rounded-2xl border border-border bg-surface/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Award className="h-4 w-4 text-signal-400" aria-hidden="true" />
            {tr.t('checkpointTitle')}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {idx + 1}/{total}
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-surface"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-signal-500 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </header>

      <section className="rounded-2xl border border-border bg-surface/40 p-5">
        <h2 className="mb-4 text-lg font-bold leading-snug text-foreground">
          {question?.prompt}
        </h2>
        <fieldset className="grid gap-2">
          <legend className="sr-only">{question?.prompt}</legend>
          {question?.options.map((opt) => {
            const isSelected = picked === opt.id;
            return (
              <label
                key={opt.id}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 text-sm transition-colors ${
                  isSelected
                    ? 'border-signal-500 bg-signal-500/10'
                    : 'border-border hover:border-signal-500/40'
                }`}
              >
                <input
                  type="radio"
                  name={`q-${question.id}`}
                  value={opt.id}
                  checked={isSelected}
                  onChange={() => setPicked(opt.id)}
                  className="h-4 w-4 shrink-0 accent-signal-500"
                />
                <span className="font-medium text-foreground">{opt.label}</span>
              </label>
            );
          })}
        </fieldset>
      </section>

      {submit.status === 'error' ? (
        <div className="flex items-center gap-3 rounded-2xl border border-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning">
          <span>
            {submit.httpStatus === 503
              ? tr.t('errorUnavailable')
              : tr.t('checkpointSubmitFailed')}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runSubmit(answers)}
            className="ml-auto"
          >
            {tr.t('retry')}
          </Button>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={!picked || pending}
          onClick={advance}
          className="min-w-[8rem] gap-1.5"
        >
          {pending ? tr.t('submitting') : isLast ? tr.t('submit') : tr.t('next')}
          {!pending ? <ArrowRight className="h-4 w-4" aria-hidden="true" /> : null}
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        {`${Math.round(passThreshold * 100)}%`}
      </p>
    </div>
  );
}

function CheckpointResult({
  locale,
  result,
  passThreshold,
  onExit,
  onRetry,
}: {
  readonly locale: ScenarioLanguage;
  readonly result: CheckpointSubmitResult;
  readonly passThreshold: number;
  readonly onExit: () => void;
  readonly onRetry: () => void;
}) {
  const tr = trainingT(locale);
  const pct = Math.round(result.score * 100);
  return (
    <div
      className="mx-auto flex max-w-2xl flex-col items-center justify-center rounded-2xl border border-border bg-surface/40 px-6 py-12 text-center"
      data-testid="checkpoint-result"
    >
      <div
        className={`mb-4 flex h-16 w-16 items-center justify-center rounded-full ${
          result.passed ? 'bg-success-subtle' : 'bg-warning-subtle'
        }`}
      >
        {result.passed ? (
          <CheckCircle2 className="h-8 w-8 text-success" aria-hidden="true" />
        ) : (
          <XCircle className="h-8 w-8 text-warning" aria-hidden="true" />
        )}
      </div>
      <h2 className="text-xl font-bold text-foreground">
        {result.passed ? tr.t('phaseMasteredTitle') : tr.t('phaseMissedTitle')}
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        <span className="tabular-nums">
          {result.correct}/{result.total}
        </span>{' '}
        · <span className="tabular-nums">{pct}%</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {result.passed
          ? tr.t('phaseUnlockedNote')
          : `${Math.round(passThreshold * 100)}%`}
      </p>

      {result.weakConceptIds.length > 0 && !result.passed ? (
        <div className="mt-5 w-full rounded-xl border border-warning/30 bg-warning/5 p-3 text-left">
          <p className="mb-1.5 text-xs font-semibold text-warning">{tr.t('reviewTheseTitle')}</p>
          <ul className="flex flex-wrap gap-1.5" role="list">
            {result.weakConceptIds.map((id) => (
              <li
                key={id}
                className="rounded-full border border-warning/30 bg-surface px-2 py-0.5 text-xs text-warning"
              >
                {id}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 flex gap-2">
        {!result.passed ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="gap-1.5"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {tr.t('retakeCheckpoint')}
          </Button>
        ) : null}
        <Button type="button" size="sm" onClick={onExit} className="gap-1.5">
          {tr.t('backToHub')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function CheckpointEmpty({
  title,
  description,
  exitLabel,
  onExit,
}: {
  readonly title: string;
  readonly description: string;
  readonly exitLabel: string;
  readonly onExit: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center justify-center rounded-2xl border border-border bg-surface/40 px-6 py-12 text-center">
      <Award className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{description}</p>
      <Button type="button" variant="outline" size="sm" onClick={onExit} className="mt-6">
        {exitLabel}
      </Button>
    </div>
  );
}
