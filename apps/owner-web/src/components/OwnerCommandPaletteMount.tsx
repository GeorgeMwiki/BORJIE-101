'use client';

/**
 * OwnerCommandPaletteMount — client wrapper that gives the root-mounted
 * Cmd-K palette its WORKING callbacks.
 *
 * The root layout is a Server Component, so it cannot pass function
 * props to `OwnerCommandPalette`. Previously it mounted the palette with
 * NO `onActionIntent` / `onSpawnTab` / `onSignOut`, which made the six
 * Quick-Action rows, every Spawn-tab row, and the sign-out row silent
 * no-ops on click. This client island supplies real handlers:
 *
 *   - onActionIntent(intent) → parks a locale-resolved brain prompt via
 *     `setQueuedPrompt` and opens the chat (the same hand-off
 *     `AskMwikilaCta` uses; the chat surface drains the queued prompt on
 *     mount and submits it as the owner's first turn).
 *   - onSpawnTab(type) → parks a "spawn a {type} tab" prompt and opens
 *     chat so the brain materialises the tab through its `spawn_tabs`
 *     path (dedup + augment applies host-side).
 *   - onSignOut() → `supabase.auth.signOut()` then bounce to /sign-in
 *     (mirrors `SignOutButton`).
 *
 * It also mounts `SuperpowerListeners`, the receivers for the two
 * born-dark superpower CustomEvents (form-prefill + highlight), so the
 * whole owner superpower surface has live consumers from one root mount.
 */

import type { ReactElement } from 'react';
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { OwnerCommandPalette } from '@/components/OwnerCommandPalette';
import { SuperpowerListeners } from '@/components/SuperpowerListeners';
import { setQueuedPrompt } from '@/lib/owner-os/queued-prompt';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { captureError } from '@/lib/sentry';
import { pickByLocale } from '@/lib/locale-shared';
import {
  commandPaletteActionPrompts,
  commandPaletteSpawnPrompt,
  type CommandPaletteActionIntent,
} from '@/i18n/strings/command-palette-actions';

const FOCUS_TAB_EVENT = 'borjie:focus-tab';
const CHAT_TAB_ID = 'chat';

/**
 * Open the chat surface: best-effort focus the chat tab (owner-os) AND
 * fire `borjie-open-chat` (floating widget). Whichever host is mounted
 * responds; the queued prompt is drained by the chat surface on mount so
 * the request survives even when neither focus signal is handled.
 */
function openChat(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(FOCUS_TAB_EVENT, { detail: { tabId: CHAT_TAB_ID } }),
  );
  window.dispatchEvent(new CustomEvent('borjie-open-chat'));
}

export function OwnerCommandPaletteMount({
  languagePreference,
}: {
  readonly languagePreference: 'sw' | 'en';
}): ReactElement {
  const router = useRouter();

  const onActionIntent = useCallback(
    (intent: string) => {
      const entry =
        commandPaletteActionPrompts[intent as CommandPaletteActionIntent];
      if (!entry) return;
      setQueuedPrompt(pickByLocale(languagePreference, entry));
      openChat();
    },
    [languagePreference],
  );

  const onSpawnTab = useCallback(
    (type: string) => {
      const prompt = pickByLocale(
        languagePreference,
        commandPaletteSpawnPrompt,
      ).replace('{type}', type);
      setQueuedPrompt(prompt);
      openChat();
    },
    [languagePreference],
  );

  const onSignOut = useCallback(() => {
    void (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        await supabase.auth.signOut();
      } catch (err) {
        captureError(err, { route: 'auth.signOut' });
      } finally {
        router.replace('/sign-in');
        router.refresh();
      }
    })();
  }, [router]);

  return (
    <>
      <OwnerCommandPalette
        languagePreference={languagePreference}
        onActionIntent={onActionIntent}
        onSpawnTab={onSpawnTab}
        onSignOut={onSignOut}
      />
      <SuperpowerListeners languagePreference={languagePreference} />
    </>
  );
}

export default OwnerCommandPaletteMount;
