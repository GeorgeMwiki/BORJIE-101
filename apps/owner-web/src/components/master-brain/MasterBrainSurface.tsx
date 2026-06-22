import type { Locale } from '@/lib/locale';
import { ChatPanel } from './ChatPanel';

interface MasterBrainSurfaceProps {
  /**
   * Server-resolved locale, threaded from the master-brain page so the
   * client ChatPanel SEEDS its first render to the active language (no
   * EN-under-SW split-brain frame).
   */
  readonly initialLocale?: Locale;
}

/**
 * Top-level Master Brain surface (O-W-02).
 *
 * There are no user-selectable modes: Mr. Mwikila reads each message and
 * decides which persona lens(es) to think through on its own — often several
 * at once. The surface is just the conversation.
 */
export function MasterBrainSurface({ initialLocale }: MasterBrainSurfaceProps = {}) {
  return (
    <div className="space-y-6 px-8 py-6">
      <ChatPanel initialLocale={initialLocale} />
    </div>
  );
}
