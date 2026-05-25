/**
 * useChatSounds — tiny WebAudio beeps for send / receive / error.
 *
 * Respects `prefers-reduced-motion` and an explicit `enabled` flag so users
 * on Settings → Accessibility → "no sounds" stay silent. All tones are
 * generated on-demand; no audio assets shipped.
 */
import { useCallback, useEffect, useRef } from 'react';

export type ChatSoundKind = 'send' | 'receive' | 'error' | 'open';

const TONES: Record<ChatSoundKind, { readonly freq: number; readonly duration: number }> = {
  send: { freq: 660, duration: 0.08 },
  receive: { freq: 880, duration: 0.1 },
  error: { freq: 220, duration: 0.18 },
  open: { freq: 520, duration: 0.06 },
};

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface UseChatSoundsResult {
  readonly playSound: (kind: ChatSoundKind) => void;
}

export function useChatSounds(enabled: boolean): UseChatSoundsResult {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      if (ctxRef.current && typeof ctxRef.current.close === 'function') {
        void ctxRef.current.close().catch(() => undefined);
      }
    };
  }, []);

  const playSound = useCallback(
    (kind: ChatSoundKind) => {
      if (!enabled) return;
      if (prefersReducedMotion()) return;
      if (typeof window === 'undefined') return;
      const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        if (!ctxRef.current) ctxRef.current = new Ctor();
        const ctx = ctxRef.current;
        const { freq, duration } = TONES[kind];
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.value = 0.05;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      } catch {
        // fail silent
      }
    },
    [enabled],
  );

  return { playSound };
}
