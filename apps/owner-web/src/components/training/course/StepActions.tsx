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
import { Button } from '@borjie/design-system';
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onBack}
          leftIcon={<ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />}
        >
          {tr.t('back')}
        </Button>
      ) : (
        <span />
      )}
      {nextKey === 'continue' ? (
        <Button
          type="button"
          size="sm"
          onClick={onNext}
          disabled={nextDisabled ?? false}
          loading={busy ?? false}
          rightIcon={<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}
        >
          {tr.t('continue')}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          onClick={onNext}
          disabled={nextDisabled ?? false}
          loading={busy ?? false}
          leftIcon={<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
        >
          {tr.t(nextKey)}
        </Button>
      )}
    </div>
  );
}
