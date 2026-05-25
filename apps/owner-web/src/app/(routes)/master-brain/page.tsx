import { ScreenHeader } from '@/components/ScreenHeader';
import { CeoModeSwitcher } from '@/components/master-brain/CeoModeSwitcher';
import { ChatStub } from '@/components/master-brain/ChatStub';

/**
 * O-W-02 — Conversational Master Brain.
 *
 * The owner's primary chat surface with all 8 CEO modes available
 * as a persona switcher. Each mode rewrites the system prompt + tool
 * surface for the next turn (see BOJI_AI_SPEC §4.2).
 */
export default function MasterBrainPage() {
  return (
    <>
      <ScreenHeader slug="master-brain" />
      <div className="space-y-6 px-8 py-6">
        <CeoModeSwitcher />
        <ChatStub />
      </div>
    </>
  );
}
