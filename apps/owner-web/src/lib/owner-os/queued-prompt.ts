/**
 * Owner-OS "Ask Brain" queued-prompt hand-off.
 *
 * The Spawn-tab menu's free-form "Ask Brain" field cannot reach the chat
 * composer directly (it lives in a sibling subtree), so it parks the
 * prompt in sessionStorage and focuses the chat tab. The chat surface
 * (`HomeChatTeach`) drains the key on mount and submits it as the first
 * turn. Centralising the key + accessors here keeps the writer and the
 * reader from drifting apart.
 */

const QUEUED_PROMPT_KEY = 'borjie:home-chat:queued-prompt';

/**
 * Park a prompt for the chat surface to pick up. Best-effort: private
 * mode / disabled storage simply drops it (the user can retype).
 */
export function setQueuedPrompt(prompt: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return;
  try {
    window.sessionStorage.setItem(QUEUED_PROMPT_KEY, trimmed);
  } catch {
    // sessionStorage unavailable (private mode / quota) — drop silently.
  }
}

/**
 * Atomically read AND clear the queued prompt. Returns null when none is
 * parked (or storage is unavailable). Clearing on read guarantees the
 * prompt is submitted exactly once, even across remounts.
 */
export function takeQueuedPrompt(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.sessionStorage.getItem(QUEUED_PROMPT_KEY);
    if (value === null) return null;
    window.sessionStorage.removeItem(QUEUED_PROMPT_KEY);
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
