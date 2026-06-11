import { ScreenHeader } from '@/components/ScreenHeader';
import { MasterBrainSurface } from '@/components/master-brain/MasterBrainSurface';

/**
 * O-W-02 — Conversational Master Brain.
 *
 * Real chat surface wired to the brain via live SSE streaming (falls back
 * to a simulated stream when the gateway is unreachable). Evidence chips
 * open a side panel showing the cited corpus chunk. Junior-call breadcrumbs
 * appear above the transcript.
 *
 * There is no user-selectable "CEO mode" switch: Mr. Mwikila selects the
 * appropriate persona lens autonomously based on the message content —
 * often activating several at once (financial, regulatory, strategic, etc.).
 * The owner interacts through a single unified conversation surface.
 */
export default function MasterBrainPage() {
  return (
    <>
      <ScreenHeader slug="master-brain" />
      <MasterBrainSurface />
    </>
  );
}
