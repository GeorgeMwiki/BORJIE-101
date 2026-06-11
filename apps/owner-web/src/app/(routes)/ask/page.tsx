import { Suspense } from 'react';
import { ScreenHeader } from '@/components/ScreenHeader';
import { AskBorjieSurface } from '@/components/ask/AskBorjieSurface';
import { RoleAdvisorPanel } from '@/components/owner-os/panels/RoleAdvisorPanel';
import { StageAdvisorPanel } from '@/components/owner-os/panels/StageAdvisorPanel';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-23 — Ask Borjie (LIVE Brain wire).
 *
 * Headline live-pilot surface that hits the LIVE
 * `POST /api/v1/brain/turn` route exposed by the api-gateway. No mock
 * data, no fallback — failures bubble through react-query to a clear
 * empty / error state on screen.
 *
 * The surface uses `useSearchParams` (Next.js 15 requires this to live
 * inside a Suspense boundary at the route level — hence the wrapper).
 *
 * Below the brain surface we mount the two universal advisor panels that
 * belong to the "ask the cockpit" mental model: the role-aware advisor
 * (`/api/v1/ask`, role-tailored answers with evidence chains) and the
 * stage-aware capability advisor (`/api/v1/stage`, lifecycle stage +
 * playbook + proactive nudges). Both render their own real loading /
 * empty / unavailable states and render strictly in the active locale.
 */
export default async function AskBorjiePage() {
  const session = await getOwnerSession();
  return (
    <>
      <ScreenHeader slug="ask" />
      <Suspense fallback={<AskBorjieFallback />}>
        <AskBorjieSurface />
      </Suspense>
      <div className="space-y-8 px-8 py-6">
        <RoleAdvisorPanel locale={session.languagePreference} />
        <StageAdvisorPanel locale={session.languagePreference} />
      </div>
    </>
  );
}

function AskBorjieFallback() {
  return (
    <div
      className="mx-auto my-12 max-w-xl rounded-lg border border-border bg-surface/40 p-6 text-sm text-neutral-400"
      data-testid="ask-suspense-fallback"
    >
      Loading Ask Borjie…
    </div>
  );
}
