'use client';

/**
 * VoicePlayButton — CE-3 hands-free reply playback.
 *
 * Tap → speak the supplied text in the owner's preferred language.
 * Tap again → stop (barge-in). Renders as a small icon button
 * suitable for mounting beside each Mr. Mwikila reply bubble.
 *
 * Bilingual labels per CLAUDE.md hard rule.
 */

import { Volume2, VolumeX } from 'lucide-react';
import {
  useSpeechSynthesis,
  type SpeechSynthesisState,
} from './use-speech-synthesis';
import type { SpeechLang } from './use-speech-recognition';
import { tailStrings as S } from '@/i18n/strings/tail';

export interface VoicePlayButtonProps {
  readonly text: string;
  readonly languagePreference: 'sw' | 'en';
  readonly disabled?: boolean;
}

function toLocale(pref: 'sw' | 'en'): SpeechLang {
  return pref === 'sw' ? 'sw-TZ' : 'en-TZ';
}

const P = S.voicePlayButton;

const LABELS = {
  sw: { play: P.play.sw, stop: P.stop.sw, unsupported: P.unsupported.sw },
  en: { play: P.play.en, stop: P.stop.en, unsupported: P.unsupported.en },
} as const;

function isActive(state: SpeechSynthesisState): boolean {
  return state.status === 'speaking';
}

export function VoicePlayButton({
  text,
  languagePreference,
  disabled,
}: VoicePlayButtonProps) {
  const labels = LABELS[languagePreference];
  const { state, speak, cancel } = useSpeechSynthesis(toLocale(languagePreference));

  if (state.status === 'unsupported') {
    return (
      <button
        type="button"
        disabled
        aria-label={labels.unsupported}
        title={labels.unsupported}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface/40 text-neutral-400"
      >
        <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    );
  }

  const active = isActive(state);
  const handleClick = (): void => {
    if (active) {
      cancel();
      return;
    }
    speak(text);
  };

  const ariaLabel = active ? labels.stop : labels.play;
  const Icon = active ? VolumeX : Volume2;
  const tone = active
    ? 'border-warning bg-warning-subtle/30 text-warning'
    : 'border-border bg-surface/40 text-foreground hover:bg-surface';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || text.trim().length === 0}
      aria-label={ariaLabel}
      aria-pressed={active}
      data-testid="voice-play-button"
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-xs disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}
