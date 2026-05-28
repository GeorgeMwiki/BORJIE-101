'use client';

/**
 * SuggestedTabBanner — the ambient "Suggested for now" chip.
 *
 * Wave OWNER-OS-DYNAMIC. Pinned above the chat input. Runs the
 * deterministic intent matcher against the owner's most recent
 * conversation snippet; when the top match clears the threshold the
 * banner renders the single best candidate as a one-click chip. The
 * owner discovers the tab system without having to type "open HR".
 *
 * The matcher is keyword + regex only (no LLM call) so this runs on
 * every keystroke without blocking.
 */

import { useMemo, type ReactElement } from 'react';
import { Lightbulb, Plus } from 'lucide-react';
import { topIntent, type OwnerOSTabDescriptor } from '@borjie/owner-os-tabs';
import { resolveIcon } from './panels/icon-map';

export interface SuggestedTabBannerProps {
  readonly languagePreference: 'sw' | 'en';
  /** Snippet of the latest owner turn — fed to the deterministic matcher. */
  readonly userMessage?: string;
  /** Snippet of the latest brain reply (post-cleanup) for stronger signal. */
  readonly brainReply?: string;
  /** Score threshold (defaults to 0.45 — high-signal only). */
  readonly threshold?: number;
  /** Callback when the owner clicks the chip. */
  readonly onSpawn: (descriptor: OwnerOSTabDescriptor) => void;
}

export function SuggestedTabBanner({
  languagePreference,
  userMessage,
  brainReply,
  threshold = 0.45,
  onSpawn,
}: SuggestedTabBannerProps): ReactElement | null {
  const match = useMemo(() => {
    const input: {
      userMessage?: string;
      brainReply?: string;
    } = {};
    if (userMessage !== undefined) input.userMessage = userMessage;
    if (brainReply !== undefined) input.brainReply = brainReply;
    return topIntent(input, {
      threshold,
      locale: languagePreference,
    });
  }, [userMessage, brainReply, threshold, languagePreference]);

  if (!match) return null;

  const isSw = languagePreference === 'sw';
  const Icon = resolveIcon(match.descriptor.iconName);
  const label = isSw ? match.descriptor.labelSw : match.descriptor.labelEn;

  return (
    <div
      role="status"
      data-testid="owner-os-suggested-banner"
      className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2"
    >
      <Lightbulb
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 text-warning"
      />
      <div className="flex-1 min-w-0">
        <p className="text-tiny uppercase tracking-wide text-warning">
          {isSw ? 'Inapendekezwa sasa' : 'Suggested for now'}
        </p>
        <p className="truncate text-xs text-neutral-300">{match.reason}</p>
      </div>
      <button
        type="button"
        onClick={() => onSpawn(match.descriptor)}
        data-testid={`owner-os-suggested-spawn-${match.descriptor.type}`}
        className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-tiny font-semibold text-warning hover:bg-warning/20"
      >
        <Icon className="h-3 w-3" />
        {label}
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}
