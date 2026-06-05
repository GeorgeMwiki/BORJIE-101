'use client';

/**
 * <StepActions> — shared footer button row for the create-course step
 * sub-components (DomainPicker has its own card-click flow; ScenarioForm and
 * DocumentAttach use this). Extracted to its own file so the step components do
 * not import back into <CreateCourseClient> (no import cycle).
 *
 * owner-web dark-theme house style; all copy through `coursesT` (zero Swahili
 * literals).
 */

import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import type { CourseLanguage } from '@borjie/api-client/courses-types';
import { coursesT } from '@/i18n/strings/courses';

interface StepActionsProps {
  readonly locale: CourseLanguage;
  readonly onBack?: () => void;
  readonly onNext: () => void;
  readonly nextKey: 'continue' | 'generate' | 'skipAndGenerate';
  readonly nextDisabled?: boolean;
  readonly busy?: boolean;
}

export function StepActions({
  locale,
  onBack,
  onNext,
  nextKey,
  nextDisabled,
  busy,
}: StepActionsProps) {
  const tr = coursesT(locale);
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-surface/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {tr.t('back')}
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled || busy}
        className="inline-flex items-center gap-1.5 rounded-full bg-signal-500 px-5 py-2 text-xs font-semibold text-background transition-colors hover:bg-signal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 disabled:opacity-50"
      >
        {nextKey === 'continue' ? (
          <>
            {tr.t('continue')}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </>
        ) : (
          <>
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {tr.t(nextKey)}
          </>
        )}
      </button>
    </div>
  );
}
