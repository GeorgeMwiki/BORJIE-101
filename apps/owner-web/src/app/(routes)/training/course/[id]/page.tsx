/**
 * Owner → Training → Course view (gap 11).
 *
 * Server-rendered shell (owner-only via getOwnerSession + middleware) that hands
 * the active locale + course id to the interactive poller island. The
 * create-course flow routes here right after kickoff; the island polls
 * GET /api/v1/courses/:id until the generated lessons land (or a generationError
 * surfaces a retry affordance).
 *
 * HONEST-DEGRADE: content is never fabricated — a `viaDeterministic` provenance
 * badge marks a course built by the deterministic concept-catalog sequencer; a
 * failed generation surfaces its message; a 503 surfaces an unavailable state.
 */

import { getOwnerSession } from '@/lib/session';
import { coursesT } from '@/i18n/strings/courses';
import { toTrainingLanguage } from '@/components/training/training-scoring';
import { CourseViewClient } from '@/components/training/CourseViewClient';

interface RouteProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function CoursePage({ params }: RouteProps) {
  const session = await getOwnerSession();
  const { id } = await params;
  const locale = toTrainingLanguage(session.languagePreference);
  const tr = coursesT(locale);

  return (
    <div className="space-y-8 px-8 py-8">
      <header className="border-b border-border pb-6">
        <p className="font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
          {tr.t('navCreateCourse')}
        </p>
        <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          {tr.t('courseViewTitle')}
        </h1>
      </header>

      <CourseViewClient locale={locale} courseId={id} />
    </div>
  );
}
