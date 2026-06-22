'use client';

import { useCallback, useState } from 'react';

import {
  describeCockpitEvent,
  useCockpitStream,
  type CockpitEvent,
} from '@/lib/cockpit-sse';
import { Toast } from '@/components/shared/Toast';
import { pickByLocale } from '@/lib/locale';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

/**
 * Cockpit live pulse — Roadmap R6.
 *
 * Owns the EventSource subscription for the cockpit page and surfaces
 * a single ephemeral Toast per incoming push. Multiple rapid events
 * coalesce into a queue so each one gets a 6-second display window.
 *
 * A small live-dot in the top-right of the cockpit indicates whether
 * the SSE channel is open. Green = receiving, grey = reconnecting.
 *
 * Localisation: the toast copy is bilingual — English when the
 * owner-web language preference is `en`, Swahili when `sw`. We resolve
 * the preference via the existing client-side persona cookie; if it's
 * missing we default to `en`.
 */
export function CockpitLivePulse({
  language = 'en',
}: {
  readonly language?: 'en' | 'sw';
}) {
  const [queue, setQueue] = useState<ReadonlyArray<CockpitEvent>>([]);

  const enqueueToast = useCallback((event: CockpitEvent) => {
    setQueue((prev) => [...prev, event]);
  }, []);

  const dismissCurrent = useCallback(() => {
    setQueue((prev) => prev.slice(1));
  }, []);

  const stream = useCockpitStream({ enabled: true, onEvent: enqueueToast });

  const current = queue[0] ?? null;

  return (
    <>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={
            stream.connected
              ? 'inline-block h-2 w-2 rounded-full bg-success'
              : 'inline-block h-2 w-2 rounded-full bg-muted-foreground'
          }
          aria-hidden
        />
        <span data-testid="cockpit-live-status">
          {stream.connected
            ? pickByLocale(language, S.pulse.live)
            : pickByLocale(language, S.pulse.reconnecting)}
        </span>
        {stream.events.length > 0 ? (
          <span data-testid="cockpit-live-count">· {stream.events.length}</span>
        ) : null}
      </div>
      {current ? (
        <Toast
          key={`${current.kind}-${current.emittedAt}`}
          message={describeCockpitEvent(current, language)}
          onDismiss={dismissCurrent}
        />
      ) : null}
    </>
  );
}
