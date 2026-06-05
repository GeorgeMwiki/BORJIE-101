/**
 * Owner → Training → Scenario simulation (gap 9).
 *
 * Server-rendered shell (owner-only via getOwnerSession + middleware) that
 * hands the active locale to the interactive client island. Lists the tenant's
 * mining rehearsal scenarios (licence-renewal negotiation, royalty dispute,
 * safety-incident triage, offtake negotiation, contractor-damage claim) and
 * runs an interactive session against the gateway's /api/v1/scenarios/* routes.
 *
 * Admin-locked role-mode deep-link (`?roleMode=<mode>`) is validated
 * SERVER-SIDE; the client only narrows it to the known allowlist and surfaces
 * the lock as a banner. HONEST-DEGRADE: a 503 / `degraded: true` yields an
 * empty / unavailable state — never fabricated content.
 */

import { getOwnerSession } from '@/lib/session';
import { trainingT } from '@/i18n/strings/training';
import { toTrainingLanguage } from '@/components/training/training-scoring';
import { ScenariosClient } from '@/components/training/ScenariosClient';

export default async function TrainingScenariosPage() {
  const session = await getOwnerSession();
  const locale = toTrainingLanguage(session.languagePreference);
  const tr = trainingT(locale);

  return (
    <div className="space-y-8 px-8 py-8">
      <header className="border-b border-border pb-6">
        <p className="font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
          {tr.t('navScenarios')}
        </p>
        <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          {tr.t('scenariosTitle')}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-neutral-300">
          {tr.t('scenariosSubtitle')}
        </p>
      </header>

      <ScenariosClient locale={locale} />
    </div>
  );
}
