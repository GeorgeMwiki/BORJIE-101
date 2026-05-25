'use client';

import { useState } from 'react';
import type { CeoModeId } from '@/lib/ceo-modes';
import { CeoModeSwitcher } from './CeoModeSwitcher';
import { ChatPanel } from './ChatPanel';

/**
 * Top-level Master Brain surface (O-W-02).
 *
 * Holds the active mode in a single hook so the switcher and the chat
 * panel stay in sync without prop-drilling through the page tree.
 */
export function MasterBrainSurface() {
  const [mode, setMode] = useState<CeoModeId>('strategy');
  return (
    <div className="space-y-6 px-8 py-6">
      <CeoModeSwitcher activeMode={mode} onChange={setMode} />
      <ChatPanel mode={mode} />
    </div>
  );
}
