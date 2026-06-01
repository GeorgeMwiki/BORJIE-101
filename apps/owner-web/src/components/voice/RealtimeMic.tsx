'use client';

/**
 * RealtimeMic — presentation for the realtime-duplex voice "call".
 *
 * Renders the single live-voice control plus an aria-live status line.
 * State is fully owned by `useRealtimeVoice`; this component is pure view
 * over the supplied `status` + an `onToggle` callback (connect / hang up).
 *
 *   idle        → tap to start a live conversation
 *   connecting  → handshake in flight (button busy)
 *   live        → listening to the owner (tap to hang up)
 *   speaking    → Mr. Mwikila is talking back (tap to hang up / barge-in)
 *
 * The `fallback` / `unsupported` / `error` statuses are handled one level
 * up in `VoiceMicButton`, which swaps in the browser mic instead — so this
 * component only ever sees the four live-path states above.
 *
 * All copy is imported from the guard-exempt i18n string tables; zero
 * Swahili literals live here.
 */

import { Loader2, Radio, AudioLines } from 'lucide-react';
import type { RealtimeVoiceStatus } from './use-realtime-voice';
import { voiceRealtimeStrings as R } from '@/i18n/strings/voice-realtime';

export interface RealtimeMicProps {
  readonly languagePreference: 'sw' | 'en';
  readonly disabled?: boolean;
  readonly status: RealtimeVoiceStatus;
  readonly onToggle: () => void;
}

const LABELS = {
  sw: {
    start: R.realtime.startLive.sw,
    end: R.realtime.endLive.sw,
    connecting: R.realtime.connecting.sw,
    live: R.realtime.live.sw,
    speaking: R.realtime.speaking.sw,
  },
  en: {
    start: R.realtime.startLive.en,
    end: R.realtime.endLive.en,
    connecting: R.realtime.connecting.en,
    live: R.realtime.live.en,
    speaking: R.realtime.speaking.en,
  },
} as const;

type Labels = (typeof LABELS)[keyof typeof LABELS];

function statusLine(status: RealtimeVoiceStatus, labels: Labels): string {
  if (status === 'connecting') return labels.connecting;
  if (status === 'speaking') return labels.speaking;
  if (status === 'live') return labels.live;
  return '';
}

function tone(status: RealtimeVoiceStatus): string {
  if (status === 'speaking') {
    return 'border-warning bg-warning-subtle/30 text-warning animate-pulse';
  }
  if (status === 'live') {
    return 'border-success/40 bg-success/10 text-success';
  }
  return 'border-border bg-surface/40 text-foreground hover:bg-surface';
}

export function RealtimeMic({
  languagePreference,
  disabled,
  status,
  onToggle,
}: RealtimeMicProps) {
  const labels = LABELS[languagePreference];
  const isConnecting = status === 'connecting';
  const isActive = status === 'live' || status === 'speaking';
  const ariaLabel = isActive ? labels.end : labels.start;
  const Icon = isConnecting ? Loader2 : status === 'speaking' ? AudioLines : Radio;

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-pressed={isActive}
        aria-busy={isConnecting}
        data-testid="voice-realtime-button"
        className={`inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm disabled:cursor-not-allowed disabled:opacity-50 ${tone(status)}`}
      >
        <Icon
          className={`h-4 w-4 ${isConnecting ? 'animate-spin' : ''}`}
          aria-hidden="true"
        />
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {statusLine(status, labels)}
      </span>
    </>
  );
}
