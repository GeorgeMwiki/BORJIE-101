'use client';

/**
 * <CreateCourseClient> — the interactive create-course island (gap 11).
 *
 * Orchestrates the three-step flow then kicks off generation:
 *   1. DomainStep    pick a mining topic area
 *   2. ScenarioStep  describe the situation + difficulty
 *   3. DocumentStep  optional grounding documents
 *   -> POST /api/v1/courses/generate (202) then route to the course view.
 *
 * Generation is async on the server (202 + placeholder id); the course page is
 * the redirect target and polls until lessons appear. Single-language per
 * render (CLAUDE.md absolute-locale rule). owner-web dark-theme house style;
 * all copy resolves through `coursesT` (zero Swahili literals in this file).
 *
 * Strict-tsconfig safe: owner-web runs exactOptionalPropertyTypes +
 * noUncheckedIndexedAccess, so optional props are never conditionally spread and
 * indexed access is guarded.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2, AlertTriangle } from 'lucide-react';
import type {
  CourseLanguage,
  CourseDifficulty,
  GenerateCourseRequest,
} from '@borjie/api-client/courses-types';
import { generateCourse, CourseGatewayError } from './course-gateway';
import { TrainingNav } from './TrainingNav';
import { DomainPicker, type DomainSelection } from './course/DomainPicker';
import { ScenarioForm, type ScenarioResult } from './course/ScenarioForm';
import { DocumentAttach, type AttachedDocument } from './course/DocumentAttach';
import { coursesT } from '@/i18n/strings/courses';

interface CreateCourseClientProps {
  readonly locale: CourseLanguage;
}

type FlowStep = 'domain' | 'scenario' | 'documents';

const STEP_ORDER: ReadonlyArray<FlowStep> = ['domain', 'scenario', 'documents'];

export function CreateCourseClient({ locale }: CreateCourseClientProps) {
  const router = useRouter();
  const tr = coursesT(locale);

  const [step, setStep] = useState<FlowStep>('domain');
  const [domain, setDomain] = useState<DomainSelection | null>(null);
  const [scenario, setScenario] = useState<ScenarioResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [errorKey, setErrorKey] = useState<'generic' | 'network' | 'unavailable' | null>(
    null,
  );

  const runGeneration = useCallback(
    async (documents: ReadonlyArray<AttachedDocument>) => {
      if (!domain || !scenario) return;
      setGenerating(true);
      setErrorKey(null);
      try {
        const difficulty: CourseDifficulty = scenario.difficulty;
        const body: GenerateCourseRequest = {
          domain: domain.domainId,
          scenarioDescription: scenario.scenarioDescription,
          difficulty,
          language: locale,
          documents: documents.map((d) => ({
            documentId: d.documentId,
            documentName: d.documentName,
            documentType: d.documentType,
            summary: d.summary,
          })),
        };
        const accepted = await generateCourse(body);
        const courseId = accepted.courseId || accepted.id;
        if (!courseId) {
          setErrorKey('generic');
          return;
        }
        router.push(`/training/course/${courseId}`);
      } catch (err) {
        if (err instanceof CourseGatewayError && err.status === 503) {
          setErrorKey('unavailable');
        } else if (err instanceof CourseGatewayError && err.status === 0) {
          setErrorKey('network');
        } else {
          setErrorKey('generic');
        }
      } finally {
        setGenerating(false);
      }
    },
    [domain, scenario, locale, router],
  );

  return (
    <div className="space-y-5">
      <TrainingNav locale={locale} />

      <StepIndicator locale={locale} step={step} />

      {step === 'domain' ? (
        <DomainPicker
          locale={locale}
          onSelect={(selection) => {
            setDomain(selection);
            setStep('scenario');
          }}
        />
      ) : null}

      {step === 'scenario' && domain ? (
        <ScenarioForm
          locale={locale}
          domainLabel={domain.label}
          onBack={() => setStep('domain')}
          onSubmit={(result) => {
            setScenario(result);
            setStep('documents');
          }}
        />
      ) : null}

      {step === 'documents' && domain && scenario ? (
        <DocumentAttach
          locale={locale}
          generating={generating}
          onBack={() => setStep('scenario')}
          onContinue={(documents) => void runGeneration(documents)}
        />
      ) : null}

      {errorKey ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {errorKey === 'unavailable'
              ? tr.t('serviceUnavailable')
              : errorKey === 'network'
                ? tr.t('generationNetworkError')
                : tr.t('generationErrorBody')}
          </span>
        </div>
      ) : null}

      {generating ? <GeneratingOverlay locale={locale} /> : null}
    </div>
  );
}

function StepIndicator({
  locale,
  step,
}: {
  readonly locale: CourseLanguage;
  readonly step: FlowStep;
}) {
  const tr = coursesT(locale);
  const labels: Readonly<Record<FlowStep, string>> = {
    domain: tr.t('stepDomain'),
    scenario: tr.t('stepScenario'),
    documents: tr.t('stepDocuments'),
  };
  const activeIndex = STEP_ORDER.indexOf(step);

  return (
    <ol
      className="flex items-center gap-2 rounded-2xl border border-border bg-surface/40 p-3"
      aria-label={tr.t('stepProgress')}
    >
      {STEP_ORDER.map((key, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <li key={key} className="flex flex-1 items-center gap-2">
            <span
              aria-current={active ? 'step' : undefined}
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                active
                  ? 'bg-signal-500 text-background'
                  : done
                    ? 'bg-signal-500/20 text-signal-300'
                    : 'bg-slate-800 text-neutral-500'
              }`}
            >
              {i + 1}
            </span>
            <span
              className={`hidden text-xs sm:inline ${
                active ? 'font-medium text-foreground' : 'text-neutral-500'
              }`}
            >
              {labels[key]}
            </span>
            {i < STEP_ORDER.length - 1 ? (
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function GeneratingOverlay({ locale }: { readonly locale: CourseLanguage }) {
  const tr = coursesT(locale);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={tr.t('generatingTitle')}
    >
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface px-8 py-10 text-center">
        <div className="relative h-12 w-12">
          <Sparkles className="h-12 w-12 text-signal-500/40" aria-hidden="true" />
          <Loader2 className="absolute inset-0 h-12 w-12 animate-spin text-signal-500" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {tr.t('generatingTitle')}
          </h2>
          <p className="mt-1 max-w-xs text-sm text-neutral-400">{tr.t('generatingBody')}</p>
        </div>
      </div>
    </div>
  );
}
