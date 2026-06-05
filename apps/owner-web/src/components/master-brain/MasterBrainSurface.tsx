import { ChatPanel } from './ChatPanel';

/**
 * Top-level Master Brain surface (O-W-02).
 *
 * There are no user-selectable modes: Mr. Mwikila reads each message and
 * decides which persona lens(es) to think through on its own — often several
 * at once. The surface is just the conversation.
 */
export function MasterBrainSurface() {
  return (
    <div className="space-y-6 px-8 py-6">
      <ChatPanel />
    </div>
  );
}
