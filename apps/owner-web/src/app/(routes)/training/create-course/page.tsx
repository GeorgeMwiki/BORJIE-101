/**
 * Owner → Training → Create course (gap 11).
 *
 * Server-rendered shell (owner-only via getOwnerSession + middleware) that hands
 * the active locale to the interactive create-course island. The operator picks
 * a mining domain, describes a scenario, optionally attaches documents, and the
 * gateway generates a tailored 5-to-8 lesson course (brain when an LLM key is
 * configured, otherwise the deterministic concept-catalog sequencer).
 *
 * HONEST-DEGRADE: generation never fabricates — a failure surfaces on the course
 * view's poller as a retry affordance; a 503 surfaces as an unavailable state.
 */

import { getOwnerSession } from '@/lib/session';
import { coursesT } from '@/i18n/strings/courses';
import { toTrainingLanguage } from '@/components/training/training-scoring';
import { CreateCourseClient } from '@/components/training/CreateCourseClient';

export default async function CreateCoursePage() {
  const session = await getOwnerSession();
  const locale = toTrainingLanguage(session.languagePreference);
  const tr = coursesT(locale);

  return (
    <div className="space-y-8 px-8 py-8">
      <header className="border-b border-border pb-6">
        <p className="font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
          {tr.t('navCreateCourse')}
        </p>
        <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          {tr.t('createTitle')}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-neutral-300">
          {tr.t('createSubtitle')}
        </p>
      </header>

      <CreateCourseClient locale={locale} />
    </div>
  );
}
