/**
 * Owner → Training → Mastery checkpoint (gap 10).
 *
 * Server-rendered shell (owner-only via getOwnerSession + middleware) that
 * hands the active locale to the interactive client island. Fetches a
 * checkpoint built SERVER-SIDE from the mining concept catalog and ordered
 * weakest-concept-first (inverse-BKT) via /api/v1/scenarios/checkpoint. The 0.7
 * pass threshold gates the next phase. An optional `?kind=<scenarioKind>`
 * scopes the checkpoint to one phase's concepts.
 *
 * HONEST-DEGRADE: questions are deterministic and never fabricated — a 503 /
 * `degraded: true` yields a graceful unavailable / empty state.
 */

import { getOwnerSession } from '@/lib/session';
import { trainingT } from '@/i18n/strings/training';
import { toTrainingLanguage } from '@/components/training/training-scoring';
import { CheckpointClient } from '@/components/training/CheckpointClient';

export default async function TrainingCheckpointPage() {
  const session = await getOwnerSession();
  const locale = toTrainingLanguage(session.languagePreference);
  const tr = trainingT(locale);

  return (
    <div className="space-y-8 px-8 py-8">
      <header className="border-b border-border pb-6">
        <p className="font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
          {tr.t('navCheckpoint')}
        </p>
        <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          {tr.t('checkpointPageTitle')}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {tr.t('checkpointPageSubtitle')}
        </p>
      </header>

      <CheckpointClient locale={locale} />
    </div>
  );
}
