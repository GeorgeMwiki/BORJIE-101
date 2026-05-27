import { Suspense } from 'react';
import { ScreenHeader } from '@/components/ScreenHeader';
import { AskBorjieSurface } from '@/components/ask/AskBorjieSurface';

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
 */
export default function AskBorjiePage() {
  return (
    <>
      <ScreenHeader slug="ask" />
      <Suspense fallback={<AskBorjieFallback />}>
        <AskBorjieSurface />
      </Suspense>
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
