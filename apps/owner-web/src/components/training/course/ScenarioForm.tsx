'use client';

/**
 * <ScenarioForm> — step 2 of the create-course flow.
 *
 * The operator describes their situation in their own words and picks a
 * difficulty. Validated client-side (>= 10 chars, mirroring the gateway's zod
 * floor) before advancing. owner-web dark-theme house style; all copy through
 * `coursesT` (zero Swahili literals).
 */

import { useState } from 'react';
import type {
  CourseLanguage,
  CourseDifficulty,
} from '@borjie/api-client/courses-types';
import { coursesT, COURSE_DIFFICULTIES } from '@/i18n/strings/courses';
import { StepActions } from './StepActions';

export interface ScenarioResult {
  readonly scenarioDescription: string;
  readonly difficulty: CourseDifficulty;
}

interface ScenarioFormProps {
  readonly locale: CourseLanguage;
  readonly domainLabel: string;
  readonly onBack: () => void;
  readonly onSubmit: (result: ScenarioResult) => void;
}

const MIN_LENGTH = 10;

export function ScenarioForm({
  locale,
  domainLabel,
  onBack,
  onSubmit,
}: ScenarioFormProps) {
  const tr = coursesT(locale);
  const [description, setDescription] = useState('');
  const [difficulty, setDifficulty] = useState<CourseDifficulty>('beginner');
  const [touched, setTouched] = useState(false);

  const trimmed = description.trim();
  const tooShort = trimmed.length < MIN_LENGTH;

  const submit = () => {
    setTouched(true);
    if (tooShort) return;
    onSubmit({ scenarioDescription: trimmed, difficulty });
  };

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-surface/40 p-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {tr.t('scenarioTitle')}
        </h2>
        <p className="mt-1 text-sm text-neutral-400">{tr.t('scenarioHint')}</p>
        <p className="mt-2 inline-flex rounded-full border border-signal-500/40 bg-signal-500/10 px-2.5 py-0.5 text-tiny font-medium text-signal-300">
          {domainLabel}
        </p>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="course-scenario"
          className="block text-xs font-medium text-neutral-400"
        >
          {tr.t('scenarioLabel')}
        </label>
        <textarea
          id="course-scenario"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => setTouched(true)}
          rows={5}
          maxLength={4000}
          aria-invalid={touched && tooShort}
          placeholder={tr.t('scenarioPlaceholder')}
          className="w-full resize-y rounded-xl border border-border bg-slate-950/40 px-3 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
        />
        {touched && tooShort ? (
          <p className="text-xs text-destructive">{tr.t('scenarioTooShort')}</p>
        ) : null}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-neutral-400">
          {tr.t('difficultyLabel')}
        </legend>
        <div className="flex flex-wrap gap-2">
          {COURSE_DIFFICULTIES.map((value) => {
            const active = difficulty === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setDifficulty(value)}
                aria-pressed={active}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 ${
                  active
                    ? 'border-signal-500 bg-signal-500 text-background'
                    : 'border-border bg-slate-950/40 text-neutral-300 hover:bg-slate-900/40'
                }`}
              >
                {tr.difficultyLabel(value)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <StepActions
        locale={locale}
        onBack={onBack}
        onNext={submit}
        nextKey="continue"
        nextDisabled={tooShort}
      />
    </section>
  );
}
