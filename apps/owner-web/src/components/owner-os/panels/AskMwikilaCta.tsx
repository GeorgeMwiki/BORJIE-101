'use client';

import type { ReactElement } from 'react';
import { Sparkles } from 'lucide-react';
import { setQueuedPrompt } from '@/lib/owner-os/queued-prompt';

/**
 * Shared "Ask Mr. Mwikila" call-to-action for owner-os panels.
 *
 * Replaces the old dead `EmptyPanelBody` buttons (which carried no
 * `onClick`). Clicking it does real work — it parks a setup prompt for
 * the home chat (`setQueuedPrompt`, the same hand-off the Spawn-tab
 * "Ask Brain" field uses) and emits a best-effort `borjie:focus-tab`
 * signal so a host that listens can pull the Chat tab forward. The
 * queued prompt is drained the next time the Chat tab mounts, so the
 * brain receives the request even when nothing handles the focus event.
 *
 * The button is locale-agnostic: BOTH the visible `label` and the
 * `prompt` are passed in already resolved to the active language, so no
 * Swahili literal lives in this component (the copy lives in the
 * guard-exempt `i18n/strings/owner-os-panels.ts`).
 */

const FOCUS_TAB_EVENT = 'borjie:focus-tab';
const CHAT_TAB_ID = 'chat';

interface AskMwikilaCtaProps {
  /** Visible button label, already locale-resolved. */
  readonly label: string;
  /** Setup question handed to the brain, already locale-resolved. */
  readonly prompt: string;
}

export function AskMwikilaCta({
  label,
  prompt,
}: AskMwikilaCtaProps): ReactElement {
  function handleClick(): void {
    setQueuedPrompt(prompt);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(FOCUS_TAB_EVENT, { detail: { tabId: CHAT_TAB_ID } }),
      );
    }
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="owner-os-panel-cta"
      className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-4 py-1.5 text-xs font-semibold text-warning hover:bg-warning/20"
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden />
      <span>{label}</span>
    </button>
  );
}
