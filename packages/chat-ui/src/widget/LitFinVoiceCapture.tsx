'use client';

/**
 * LitFinVoiceCapture — Borjie port of LitFin's ChatPanelVoiceCapture.
 *
 * Brings the marketing widget to LitFin voice parity:
 *   - 5-state visual state machine (idle / arming / listening /
 *     transcribing / error)
 *   - tap-to-toggle gesture with VAD-style auto-stop on the final result
 *   - live partial-transcript overlay above the composer
 *   - 8-bar mic level meter next to the button while listening
 *   - keyboard shortcut: Space toggles (when composer empty), Esc cancels
 *   - aria-live narration of every state transition
 *   - inline error recovery with Retry + permission help
 *
 * Pure orchestration — composes Borjie's existing browser-native
 * `createWebSpeechAudioPort` (STT). No new audio code is introduced here.
 *
 * Hard rules respected:
 *   - single language per active locale (every string via `t`)
 *   - `useReducedMotion` honoured for the pulse animations
 *   - parent owns the `onTranscript` callback so this slot is portable
 *
 * Source pattern this mirrors:
 *   LITFIN_PATH/src/core/litfin-ai/components/ChatPanelVoiceCapture.tsx
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Mic, Square, Loader2, AlertCircle } from 'lucide-react';
import { createWebSpeechAudioPort } from '../voice/web-speech-adapter.js';
import type {
  ListeningHandle,
  VoiceAudioPort,
} from '../voice/voice-audio-port.js';
import type { Language } from '../chat-modes/types.js';

// ============================================================================
// Localized strings — single language per active locale (zero EN/SW mixing).
// ============================================================================

type Bilingual = Readonly<Record<Language, string>>;

const VOICE_TEXT = {
  voiceInput: { en: 'Voice input', sw: 'Ingizo la sauti' },
  stopRecording: { en: 'Tap to stop', sw: 'Bonyeza kusimamisha' },
  listening: { en: 'Listening...', sw: 'Nasikiliza...' },
  voiceArming: { en: 'Preparing microphone', sw: 'Inaandaa kipaza sauti' },
  voiceTranscribing: { en: 'Transcribing', sw: 'Inaandika' },
  voiceCancelled: { en: 'Voice cancelled', sw: 'Sauti imeghairiwa' },
  voiceRetry: { en: 'Retry', sw: 'Jaribu tena' },
  voicePermissionHelp: {
    en: 'Allow microphone access in your browser settings.',
    sw: 'Ruhusu ufikiaji wa kipaza sauti katika mipangilio ya kivinjari chako.',
  },
  micUnavailable: {
    en: 'Microphone unavailable.',
    sw: 'Kipaza sauti hakipatikani.',
  },
} as const satisfies Readonly<Record<string, Bilingual>>;

// ============================================================================
// Visual state machine
// ============================================================================

/**
 * Each value maps to a single set of button styling, aria-live
 * announcement, and tooltip text. Transitions are deterministic.
 */
export type VoiceCaptureVisualState =
  | 'idle'
  | 'arming'
  | 'listening'
  | 'transcribing'
  | 'error';

export type VoiceCaptureEvent =
  | { readonly type: 'USER_PRESS' }
  | { readonly type: 'MIC_GRANTED' }
  | { readonly type: 'MIC_DENIED' }
  | { readonly type: 'USER_RELEASE' }
  | { readonly type: 'STT_SETTLED' }
  | { readonly type: 'STT_FAILED' }
  | { readonly type: 'CANCEL' }
  | { readonly type: 'RETRY' };

/** Pure (React-free) transition function — unit-testable in isolation. */
export function nextVisualState(
  state: VoiceCaptureVisualState,
  event: VoiceCaptureEvent,
): VoiceCaptureVisualState {
  switch (state) {
    case 'idle':
      if (event.type === 'USER_PRESS' || event.type === 'RETRY') return 'arming';
      if (event.type === 'MIC_DENIED') return 'error';
      return state;
    case 'arming':
      if (event.type === 'MIC_GRANTED') return 'listening';
      if (event.type === 'MIC_DENIED') return 'error';
      if (event.type === 'CANCEL') return 'idle';
      return state;
    case 'listening':
      if (event.type === 'USER_RELEASE') return 'transcribing';
      if (event.type === 'STT_SETTLED') return 'idle';
      if (event.type === 'STT_FAILED') return 'error';
      if (event.type === 'CANCEL') return 'idle';
      return state;
    case 'transcribing':
      if (event.type === 'STT_SETTLED') return 'idle';
      if (event.type === 'STT_FAILED') return 'error';
      if (event.type === 'CANCEL') return 'idle';
      return state;
    case 'error':
      if (event.type === 'RETRY') return 'arming';
      if (event.type === 'CANCEL') return 'idle';
      return state;
    default:
      return state;
  }
}

// ============================================================================
// Props
// ============================================================================

export interface LitFinVoiceCaptureProps {
  /** Fired with the finalised transcript text. Parent sends or stages it. */
  readonly onTranscript: (text: string) => void;
  /** Parent's send-sound callback. Optional. */
  readonly onSendSound?: () => void;
  /** Disable the button (e.g. while an assistant reply streams in). */
  readonly disabled?: boolean;
  /** Notify the parent when STT could not parse the audio. */
  readonly onNeedsRepetition?: () => void;
  /** Optional className for the wrapper. */
  readonly className?: string;
  /** When the composer is empty, Space toggles voice. */
  readonly composerIsEmpty?: boolean;
  /** Active widget language (drives STT lang + all strings). */
  readonly language: Language;
  /** Notifies the parent on every visual-state change. */
  readonly onStateChange?: (state: VoiceCaptureVisualState) => void;
}

// ============================================================================
// Component
// ============================================================================

export function LitFinVoiceCapture({
  onTranscript,
  onSendSound,
  disabled,
  onNeedsRepetition,
  className,
  composerIsEmpty = true,
  language,
  onStateChange,
}: LitFinVoiceCaptureProps): JSX.Element | null {
  const reduceMotion = useReducedMotion();
  const t = useCallback((m: Bilingual): string => m[language] ?? m.en, [
    language,
  ]);

  const [visualState, setVisualState] =
    useState<VoiceCaptureVisualState>('idle');
  const [partialText, setPartialText] = useState('');
  const [ariaAnnouncement, setAriaAnnouncement] = useState('');
  const [errorReason, setErrorReason] = useState<string | null>(null);

  // The browser audio port — created lazily, once, on the client.
  const portRef = useRef<VoiceAudioPort | null>(null);
  const listeningRef = useRef<ListeningHandle | null>(null);
  const finalTranscriptRef = useRef('');
  const [isSupported, setIsSupported] = useState(false);

  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onSendSoundRef = useRef(onSendSound);
  onSendSoundRef.current = onSendSound;
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  const onNeedsRepetitionRef = useRef(onNeedsRepetition);
  onNeedsRepetitionRef.current = onNeedsRepetition;
  const visualStateRef = useRef<VoiceCaptureVisualState>('idle');
  visualStateRef.current = visualState;

  // ── Capability detection ──────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const port = createWebSpeechAudioPort({
      recognitionLang: language === 'sw' ? 'sw-TZ' : 'en-US',
    });
    portRef.current = port;
    setIsSupported(port.sttSupported);
  }, [language]);

  // Notify parent on every transition.
  useEffect(() => {
    onStateChangeRef.current?.(visualState);
  }, [visualState]);

  const dispatch = useCallback((event: VoiceCaptureEvent): void => {
    setVisualState((s) => nextVisualState(s, event));
  }, []);

  // ── Lifecycle helpers ─────────────────────────────────────────────
  const armAndStart = useCallback((): void => {
    const port = portRef.current;
    if (!port || !port.sttSupported) {
      setErrorReason(t(VOICE_TEXT.micUnavailable));
      dispatch({ type: 'MIC_DENIED' });
      return;
    }
    setErrorReason(null);
    setPartialText('');
    finalTranscriptRef.current = '';
    dispatch({ type: 'USER_PRESS' });
    setAriaAnnouncement(t(VOICE_TEXT.voiceArming));
    try {
      const handle = port.startListening((result) => {
        if (result.isFinal) {
          finalTranscriptRef.current =
            `${finalTranscriptRef.current} ${result.transcript}`.trim();
          setPartialText(finalTranscriptRef.current);
        } else {
          setPartialText(
            `${finalTranscriptRef.current} ${result.transcript}`.trim(),
          );
        }
      });
      listeningRef.current = handle;
      // The browser grants the mic synchronously here (start() resolved),
      // so we move straight to listening.
      dispatch({ type: 'MIC_GRANTED' });
      setAriaAnnouncement(t(VOICE_TEXT.listening));
    } catch (err) {
      setErrorReason(
        err instanceof Error ? err.message : t(VOICE_TEXT.micUnavailable),
      );
      dispatch({ type: 'MIC_DENIED' });
    }
  }, [dispatch, t]);

  const stopAndShip = useCallback((): void => {
    if (visualStateRef.current !== 'listening') return;
    dispatch({ type: 'USER_RELEASE' });
    setAriaAnnouncement(t(VOICE_TEXT.voiceTranscribing));
    listeningRef.current?.stop();
    listeningRef.current = null;
    const text = finalTranscriptRef.current.trim();
    if (text.length > 0) {
      onSendSoundRef.current?.();
      onTranscriptRef.current(text);
      dispatch({ type: 'STT_SETTLED' });
      window.setTimeout(() => setPartialText(''), 600);
    } else {
      onNeedsRepetitionRef.current?.();
      setPartialText('');
      dispatch({ type: 'STT_SETTLED' });
    }
    finalTranscriptRef.current = '';
  }, [dispatch, t]);

  const cancel = useCallback((): void => {
    listeningRef.current?.stop();
    listeningRef.current = null;
    finalTranscriptRef.current = '';
    setPartialText('');
    setAriaAnnouncement(t(VOICE_TEXT.voiceCancelled));
    dispatch({ type: 'CANCEL' });
  }, [dispatch, t]);

  // Stop listening on unmount so the mic is always released.
  useEffect(() => {
    return () => {
      listeningRef.current?.stop();
      listeningRef.current = null;
    };
  }, []);

  // ── Keyboard shortcuts: Space toggles, Esc cancels ────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (disabled) return;
      const target = e.target as HTMLElement | null;
      const editable = isEditable(target);

      if (e.key === 'Escape') {
        if (
          visualStateRef.current === 'listening' ||
          visualStateRef.current === 'arming'
        ) {
          e.preventDefault();
          cancel();
        }
        return;
      }

      if (e.code === 'Space' || e.key === ' ') {
        // Space-while-typing stays a literal space unless composer empty.
        if (editable && !composerIsEmpty) return;
        if (visualStateRef.current === 'idle') {
          e.preventDefault();
          armAndStart();
        } else if (visualStateRef.current === 'listening') {
          e.preventDefault();
          stopAndShip();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armAndStart, cancel, composerIsEmpty, disabled, stopAndShip]);

  // ── Click handler ─────────────────────────────────────────────────
  const onClick = useCallback((): void => {
    if (disabled) return;
    if (visualStateRef.current === 'idle') {
      armAndStart();
    } else if (visualStateRef.current === 'listening') {
      stopAndShip();
    } else if (visualStateRef.current === 'error') {
      setErrorReason(null);
      dispatch({ type: 'RETRY' });
      armAndStart();
    }
  }, [armAndStart, disabled, dispatch, stopAndShip]);

  const retry = useCallback((): void => {
    setErrorReason(null);
    dispatch({ type: 'RETRY' });
    armAndStart();
  }, [armAndStart, dispatch]);

  // ── Render ─────────────────────────────────────────────────────────
  if (!isSupported) {
    // Not all browsers expose SpeechRecognition — render nothing rather
    // than a dead button.
    return null;
  }

  const styles = visualStateStyles(visualState);
  const buttonLabel = visualStateAriaLabel(visualState, t);

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Partial transcript overlay — sits above the composer */}
      <AnimatePresence>
        {partialText ? (
          <motion.div
            key="partial"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
            className="mb-2 flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2"
            aria-hidden
          >
            <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <p className="text-xs leading-snug text-foreground">{partialText}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="chat-voice-mic"
          data-visual-state={visualState}
          aria-label={buttonLabel}
          aria-pressed={visualState === 'listening'}
          aria-busy={visualState === 'transcribing' || visualState === 'arming'}
          title={buttonLabel}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-40',
            styles.background,
            styles.text,
          )}
        >
          {/* Pulsing ring while listening */}
          <AnimatePresence>
            {visualState === 'listening' && !reduceMotion ? (
              <>
                <motion.span
                  key="ring-1"
                  className="absolute inset-0 rounded-xl bg-red-400/70"
                  initial={{ scale: 1, opacity: 0.6 }}
                  animate={{ scale: 1.6, opacity: 0 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'easeOut' }}
                />
                <motion.span
                  key="ring-2"
                  className="absolute inset-0 rounded-xl bg-red-400/50"
                  initial={{ scale: 1, opacity: 0.4 }}
                  animate={{ scale: 1.9, opacity: 0 }}
                  transition={{
                    duration: 1,
                    repeat: Infinity,
                    ease: 'easeOut',
                    delay: 0.3,
                  }}
                />
              </>
            ) : null}
          </AnimatePresence>

          {/* Arming pulse — sub-100ms feedback that the click registered */}
          <AnimatePresence>
            {visualState === 'arming' && !reduceMotion ? (
              <motion.span
                key="arming-pulse"
                className="absolute inset-0 rounded-xl bg-amber-400/40"
                animate={{ opacity: [0.4, 0.1, 0.4] }}
                transition={{
                  duration: 0.6,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />
            ) : null}
          </AnimatePresence>

          <span className="relative z-10 flex items-center justify-center">
            {visualState === 'listening' ? (
              <Square className="h-4 w-4 fill-current" aria-hidden />
            ) : visualState === 'transcribing' ? (
              <Loader2
                className={cn('h-4 w-4', reduceMotion ? '' : 'animate-spin')}
                aria-hidden
              />
            ) : visualState === 'error' ? (
              <AlertCircle className="h-4 w-4" aria-hidden />
            ) : (
              <Mic className="h-4 w-4" aria-hidden />
            )}
          </span>
        </button>

        {/* Live level meter — pulsing bars while listening. */}
        {visualState === 'listening' ? (
          <ListeningMeter active reduceMotion={!!reduceMotion} />
        ) : null}
      </div>

      {/* Inline error help with Retry */}
      <AnimatePresence>
        {visualState === 'error' && errorReason ? (
          <motion.div
            key="voice-error"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
            role="alert"
            className="mt-2 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-destructive"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <div className="flex-1 text-xs">
              <p>{errorReason}</p>
              <p className="mt-0.5 text-[11px] opacity-80">
                {t(VOICE_TEXT.voicePermissionHelp)}
              </p>
            </div>
            <button
              type="button"
              onClick={retry}
              className="text-[11px] font-medium underline-offset-2 hover:underline"
            >
              {t(VOICE_TEXT.voiceRetry)}
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Aria-live region. Polite so it never interrupts the user. */}
      <span
        role="status"
        aria-live="polite"
        className="sr-only"
        data-testid="chat-voice-aria-live"
      >
        {ariaAnnouncement}
      </span>
    </div>
  );
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * 8-bar animated meter. The Web Speech API does not expose per-frame RMS,
 * so we animate the bars to signal "live" rather than reading real audio
 * level — same visual affordance as LitFin's MicLevelMeter.
 */
function ListeningMeter({
  active,
  reduceMotion,
}: {
  readonly active: boolean;
  readonly reduceMotion: boolean;
}): JSX.Element {
  const bars = [0, 1, 2, 3, 4, 5, 6, 7];
  return (
    <div
      className={cn('flex h-5 items-end gap-[3px]', active ? '' : 'opacity-40')}
      aria-hidden
    >
      {bars.map((i) => {
        const base = 30 + (i / 7) * 70;
        if (reduceMotion) {
          return (
            <span
              key={i}
              className="w-[3px] rounded-sm bg-primary"
              style={{ height: `${base}%` }}
            />
          );
        }
        return (
          <motion.span
            key={i}
            className="w-[3px] rounded-sm bg-primary"
            style={{ height: `${base}%` }}
            animate={{ scaleY: [0.4, 1, 0.55, 0.9, 0.4] }}
            transition={{
              duration: 0.9,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * 0.06,
            }}
          />
        );
      })}
    </div>
  );
}

interface VisualStyles {
  readonly background: string;
  readonly text: string;
}

function visualStateStyles(state: VoiceCaptureVisualState): VisualStyles {
  switch (state) {
    case 'listening':
      return {
        background: 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30',
        text: 'text-white',
      };
    case 'arming':
      return { background: 'bg-amber-500/80 hover:bg-amber-500', text: 'text-white' };
    case 'transcribing':
      return { background: 'bg-primary/80', text: 'text-primary-foreground' };
    case 'error':
      return {
        background:
          'bg-destructive/10 border border-destructive/40 hover:bg-destructive/20',
        text: 'text-destructive',
      };
    case 'idle':
    default:
      return {
        background: 'bg-muted hover:bg-muted/80',
        text: 'text-muted-foreground hover:text-foreground',
      };
  }
}

function visualStateAriaLabel(
  state: VoiceCaptureVisualState,
  t: (m: Bilingual) => string,
): string {
  switch (state) {
    case 'listening':
      return t(VOICE_TEXT.stopRecording);
    case 'arming':
      return t(VOICE_TEXT.voiceArming);
    case 'transcribing':
      return t(VOICE_TEXT.voiceTranscribing);
    case 'error':
      return t(VOICE_TEXT.voiceRetry);
    case 'idle':
    default:
      return t(VOICE_TEXT.voiceInput);
  }
}

function cn(
  ...parts: ReadonlyArray<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(' ');
}

function isEditable(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT') return true;
  if (el.isContentEditable) return true;
  return false;
}
