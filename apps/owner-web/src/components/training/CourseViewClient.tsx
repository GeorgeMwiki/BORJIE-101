'use client';

/**
 * <CourseViewClient> — generated course view + generation poller (gap 11).
 *
 * The create-course flow routes here right after kickoff. Generation runs in
 * the background, so this island polls GET /api/v1/courses/:id until the lessons
 * land (or a generationError surfaces). Four states:
 *   - loading    : first fetch in flight -> skeleton
 *   - generating : status 'draft', lessonCount 0, no generationError -> spinner
 *   - failed     : status 'draft' WITH generationError -> retry affordance
 *   - ready      : lessons present -> render
 *
 * Single-language per render. Lessons render in a stepper with the first lesson
 * expanded; the quiz is shown as a count here (taking the quiz is a separate
 * surface's concern). owner-web dark-theme house style; all copy through
 * `coursesT` (zero Swahili literals). Honest-degrade: a `viaDeterministic`
 * provenance badge is shown when the deterministic sequencer built the course.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  ChevronDown,
  ChevronRight,
  ServerCrash,
  Database,
} from 'lucide-react';
import { Button } from '@borjie/design-system';
import type {
  CourseLanguage,
  CourseWithLessons,
  CourseLessonRow,
} from '@borjie/api-client/courses-types';
import { getCourse, CourseGatewayError } from './course-gateway';
import { TrainingNav } from './TrainingNav';
import { coursesT } from '@/i18n/strings/courses';
import { difficultyChipClass } from './training-scoring';

interface CourseViewClientProps {
  readonly locale: CourseLanguage;
  readonly courseId: string;
}

const POLL_INTERVAL_MS = 2_500;

function isReady(course: CourseWithLessons | null): boolean {
  return !!course && course.lessons.length > 0 && !course.generationError;
}

function isFailed(course: CourseWithLessons | null): boolean {
  return !!course && !!course.generationError;
}

export function CourseViewClient({ locale, courseId }: CourseViewClientProps) {
  const tr = coursesT(locale);
  const [course, setCourse] = useState<CourseWithLessons | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    try {
      const data = await getCourse(courseId);
      setCourse(data);
      setErrorStatus(null);
      // Keep polling while still generating; stop once ready or failed.
      if (!isReady(data) && !isFailed(data)) {
        timer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
    } catch (err) {
      const status = err instanceof CourseGatewayError ? err.status : 0;
      setErrorStatus(status);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    if (!courseId) {
      setLoading(false);
      return;
    }
    void poll();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [courseId, poll]);

  return (
    <div className="space-y-5">
      <TrainingNav locale={locale} />

      {loading ? <CourseSkeleton /> : null}

      {!loading && errorStatus !== null ? (
        <ErrorPanel
          locale={locale}
          unavailable={errorStatus === 503}
          onRetry={() => {
            setLoading(true);
            void poll();
          }}
        />
      ) : null}

      {!loading && errorStatus === null && course && isFailed(course) ? (
        <FailedPanel
          locale={locale}
          message={course.generationError ?? tr.t('generationFailed')}
        />
      ) : null}

      {!loading &&
      errorStatus === null &&
      course &&
      !isFailed(course) &&
      !isReady(course) ? (
        <GeneratingPanel locale={locale} />
      ) : null}

      {!loading && errorStatus === null && course && isReady(course) ? (
        <ReadyCourse locale={locale} course={course} />
      ) : null}
    </div>
  );
}

function CourseSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="h-28 w-full animate-pulse rounded-2xl bg-surface/40" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-14 w-full animate-pulse rounded-2xl bg-surface/40" />
      ))}
    </div>
  );
}

function GeneratingPanel({ locale }: { readonly locale: CourseLanguage }) {
  const tr = coursesT(locale);
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface/40 py-12 text-center">
      <div className="relative h-10 w-10">
        <Sparkles className="h-10 w-10 text-signal-500/40" aria-hidden="true" />
        <Loader2 className="absolute inset-0 h-10 w-10 animate-spin text-signal-500" aria-hidden="true" />
      </div>
      <p className="text-sm text-neutral-400">{tr.t('generating')}</p>
    </div>
  );
}

function ErrorPanel({
  locale,
  unavailable,
  onRetry,
}: {
  readonly locale: CourseLanguage;
  readonly unavailable: boolean;
  readonly onRetry: () => void;
}) {
  const tr = coursesT(locale);
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
    >
      <ServerCrash className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span>{unavailable ? tr.t('serviceUnavailable') : tr.t('loadError')}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="ml-auto"
      >
        {tr.t('retry')}
      </Button>
    </div>
  );
}

function FailedPanel({
  locale,
  message,
}: {
  readonly locale: CourseLanguage;
  readonly message: string;
}) {
  const tr = coursesT(locale);
  return (
    <div className="space-y-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center">
      <AlertTriangle className="mx-auto h-9 w-9 text-destructive" aria-hidden="true" />
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {tr.t('generationFailedTitle')}
        </h2>
        <p className="mt-1 text-sm text-neutral-300">{message}</p>
      </div>
      <Link
        href="/training/create-course"
        className="inline-flex items-center gap-1.5 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400"
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        {tr.t('tryAgain')}
      </Link>
    </div>
  );
}

function ReadyCourse({
  locale,
  course,
}: {
  readonly locale: CourseLanguage;
  readonly course: CourseWithLessons;
}) {
  const tr = coursesT(locale);
  const totalMinutes = useMemo(
    () =>
      course.lessons.reduce(
        (acc, l) => acc + (l.content?.estimatedMinutes ?? 0),
        0,
      ),
    [course.lessons],
  );

  return (
    <div className="space-y-4">
      <header className="rounded-2xl border border-border bg-surface/40 p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded-full border px-2 py-0.5 text-tiny font-medium ${difficultyChipClass(
              course.difficulty,
            )}`}
          >
            {tr.difficultyLabel(course.difficulty)}
          </span>
          <span className="text-neutral-500">
            {tr.tp('lessonCount', { count: course.lessonCount })}
          </span>
          {totalMinutes > 0 ? (
            <span className="text-neutral-500">
              {tr.tp('minutes', { count: totalMinutes })}
            </span>
          ) : null}
          <ProvenanceBadge locale={locale} via={course.generatedVia} />
        </div>
        <h1 className="mt-3 text-xl font-semibold text-foreground">{course.title}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">
          {course.summary}
        </p>
      </header>

      <ol className="space-y-3" role="list">
        {course.lessons.map((lesson, index) => (
          <li key={lesson.id}>
            <LessonCard locale={locale} lesson={lesson} defaultOpen={index === 0} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function ProvenanceBadge({
  locale,
  via,
}: {
  readonly locale: CourseLanguage;
  readonly via: CourseWithLessons['generatedVia'];
}) {
  const tr = coursesT(locale);
  if (via === 'llm') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-signal-500/40 bg-signal-500/10 px-2 py-0.5 text-tiny font-medium text-signal-300">
        <Sparkles className="h-3 w-3" aria-hidden="true" />
        {tr.t('viaLlm')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-slate-900/60 px-2 py-0.5 text-tiny font-medium text-neutral-400">
      <Database className="h-3 w-3" aria-hidden="true" />
      {tr.t('viaDeterministic')}
    </span>
  );
}

function LessonCard({
  locale,
  lesson,
  defaultOpen,
}: {
  readonly locale: CourseLanguage;
  readonly lesson: CourseLessonRow;
  readonly defaultOpen: boolean;
}) {
  const tr = coursesT(locale);
  const [open, setOpen] = useState(defaultOpen);
  const content = lesson.content;
  const objectives = content?.objectives ?? [];
  const keyTakeaways = content?.keyTakeaways ?? [];
  const quiz = content?.quiz ?? [];

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-signal-500/10 text-xs font-semibold tabular-nums text-signal-300">
          {lesson.lessonNumber}
        </span>
        <span className="flex-1 text-sm font-medium text-foreground">
          {lesson.lessonTitle}
        </span>
        {lesson.status === 'completed' ? (
          <CheckCircle2
            className="h-4 w-4 text-emerald-400"
            aria-label={tr.t('completed')}
          />
        ) : null}
        {open ? (
          <ChevronDown className="h-4 w-4 text-neutral-500" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4 text-neutral-500" aria-hidden="true" />
        )}
      </button>

      {open && content ? (
        <div className="space-y-4 border-t border-border px-4 py-4">
          {objectives.length > 0 ? (
            <div>
              <h3 className="text-tiny font-semibold uppercase tracking-eyebrow-wide text-neutral-500">
                {tr.t('objectives')}
              </h3>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-neutral-300">
                {objectives.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {content.content ? (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-200">
              {content.content}
            </div>
          ) : null}

          {keyTakeaways.length > 0 ? (
            <div className="rounded-xl border border-signal-500/30 bg-signal-500/5 p-3">
              <h3 className="text-tiny font-semibold uppercase tracking-eyebrow-wide text-signal-300">
                {tr.t('keyTakeaways')}
              </h3>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-neutral-200">
                {keyTakeaways.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {quiz.length > 0 ? (
            <p className="text-xs text-neutral-500">
              {tr.tp('quizCount', { count: quiz.length })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
