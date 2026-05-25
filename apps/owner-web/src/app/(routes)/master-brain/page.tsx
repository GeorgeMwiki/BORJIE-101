import { ScreenHeader } from '@/components/ScreenHeader';
import { MasterBrainSurface } from '@/components/master-brain/MasterBrainSurface';

/**
 * O-W-02 — Conversational Master Brain.
 *
 * Real chat surface with all 8 CEO modes, live SSE streaming (falls
 * back to a simulated stream when the gateway is unreachable),
 * evidence chips that open a side panel showing the cited chunk, and
 * junior-call breadcrumbs above the transcript.
 */
export default function MasterBrainPage() {
  return (
    <>
      <ScreenHeader slug="master-brain" />
      <MasterBrainSurface />
    </>
  );
}
