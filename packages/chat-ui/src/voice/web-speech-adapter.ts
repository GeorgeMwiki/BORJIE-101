/**
 * Web Speech API adapter for `VoiceAudioPort`.
 *
 * Browser-only. No external service, no API key. Capability detection
 * is done at construction time so callers can render gracefully when
 * the user's browser lacks STT or TTS.
 *
 * STT uses `SpeechRecognition` (with the legacy `webkitSpeechRecognition`
 * fallback for Safari and older Chrome). TTS uses `SpeechSynthesis`.
 */

import type {
  ListeningHandle,
  SpeakOptions,
  SpeechToTextResult,
  VoiceAudioPort,
  VoiceDescriptor,
} from './voice-audio-port.js';
import { logger } from '../logger.js';

export interface CreateWebSpeechAudioPortOptions {
  /** BCP-47 language tag for STT recognition. Defaults to navigator.language. */
  readonly recognitionLang?: string;
  /** Continuous mode — keep listening past one phrase. Default false. */
  readonly continuous?: boolean;
}

const NO_WINDOW = typeof window === 'undefined';

// Inline structural types for the experimental Web Speech API surface.
// We don't rely on the ambient `web-speech.d.ts` here because downstream
// packages that consume chat-ui's source (types-to-source resolution)
// may not include this package's d.ts files in their tsconfig.
interface SpeechRecognitionInstanceShape {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ readonly isFinal: boolean; readonly length: number; readonly [index: number]: { readonly transcript: string; readonly confidence: number } }> }) => void) | null;
  onerror: ((ev: { error: string; message: string }) => void) | null;
  onend: ((ev: Event) => void) | null;
  onstart: ((ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstanceShape;

function pickRecognitionCtor(): SpeechRecognitionCtor | null {
  if (NO_WINDOW) return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function hasSpeechSynthesis(): boolean {
  return !NO_WINDOW && 'speechSynthesis' in window;
}

function defaultLang(): string {
  if (NO_WINDOW) return 'en-US';
  return navigator.language || 'en-US';
}

export function createWebSpeechAudioPort(
  opts: CreateWebSpeechAudioPortOptions = {},
): VoiceAudioPort {
  const RecognitionCtor = pickRecognitionCtor();
  const sttSupported = RecognitionCtor !== null;
  const ttsSupported = hasSpeechSynthesis();
  const recognitionLang = opts.recognitionLang ?? defaultLang();
  const continuous = opts.continuous ?? false;

  function startListening(onResult: (r: SpeechToTextResult) => void): ListeningHandle {
    if (!RecognitionCtor) {
      throw new Error('Speech recognition not supported in this browser.');
    }
    const recognition = new RecognitionCtor();
    recognition.lang = recognitionLang;
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let stopped = false;

    recognition.onresult = (event): void => {
      // Iterate only through new results since `resultIndex`.
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (!r) continue;
        const alt = r[0];
        if (!alt) continue;
        const result: SpeechToTextResult = {
          transcript: alt.transcript ?? '',
          isFinal: r.isFinal,
          confidence: typeof alt.confidence === 'number' ? alt.confidence : 0,
        };
        try {
          onResult(result);
        } catch (err) {
          // Don't let callback failures kill the recognition session.
          logger.error('voice-audio-port onResult callback failed', { error: err });
        }
      }
    };

    recognition.onerror = (event): void => {
      // 'no-speech' and 'aborted' are benign; surface anything else.
      if (event.error && event.error !== 'no-speech' && event.error !== 'aborted') {
        logger.warn('SpeechRecognition error', { arg0: event.error, arg1: event.message });
      }
    };

    try {
      recognition.start();
    } catch (err) {
      throw new Error(
        `Could not start speech recognition: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      stop(): void {
        if (stopped) return;
        stopped = true;
        try {
          recognition.stop();
        } catch {
          // Some browsers throw if stop() is called before start finishes.
        }
      },
    };
  }

  async function speak(text: string, speakOpts: SpeakOptions = {}): Promise<void> {
    if (!ttsSupported) {
      throw new Error('Speech synthesis not supported in this browser.');
    }
    const trimmed = text.trim();
    if (!trimmed) return;

    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(trimmed);
    if (typeof speakOpts.pitch === 'number') utterance.pitch = speakOpts.pitch;
    if (typeof speakOpts.rate === 'number') utterance.rate = speakOpts.rate;

    if (speakOpts.voice) {
      const all = await voices();
      const match = all.find((v) => v.id === speakOpts.voice);
      if (match) {
        const native = synth.getVoices().find((v) => v.voiceURI === match.id);
        if (native) utterance.voice = native;
        utterance.lang = match.lang;
      }
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        try {
          synth.cancel();
        } catch {
          /* swallow */
        }
        reject(new DOMException('Speech aborted', 'AbortError'));
      };

      utterance.onend = (): void => {
        if (settled) return;
        settled = true;
        speakOpts.signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      utterance.onerror = (ev: SpeechSynthesisErrorEvent): void => {
        if (settled) return;
        settled = true;
        speakOpts.signal?.removeEventListener('abort', onAbort);
        // Treat 'canceled'/'interrupted' as graceful resolution.
        if (ev.error === 'canceled' || ev.error === 'interrupted') {
          resolve();
        } else {
          reject(new Error(`Speech synthesis failed: ${ev.error}`));
        }
      };

      if (speakOpts.signal) {
        if (speakOpts.signal.aborted) {
          onAbort();
          return;
        }
        speakOpts.signal.addEventListener('abort', onAbort, { once: true });
      }

      try {
        synth.speak(utterance);
      } catch (err) {
        if (settled) return;
        settled = true;
        speakOpts.signal?.removeEventListener('abort', onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  function cancelSpeech(): void {
    if (!ttsSupported) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* swallow */
    }
  }

  function voices(): Promise<ReadonlyArray<VoiceDescriptor>> {
    if (!ttsSupported) return Promise.resolve([]);
    const synth = window.speechSynthesis;
    const list = synth.getVoices();
    if (list.length > 0) {
      return Promise.resolve(list.map(toDescriptor));
    }
    // Some browsers (Chrome) populate asynchronously; wait once.
    return new Promise((resolve) => {
      const handler = (): void => {
        synth.removeEventListener('voiceschanged', handler);
        resolve(synth.getVoices().map(toDescriptor));
      };
      synth.addEventListener('voiceschanged', handler, { once: true });
      // Hard timeout in case `voiceschanged` never fires.
      setTimeout(() => {
        synth.removeEventListener('voiceschanged', handler);
        resolve(synth.getVoices().map(toDescriptor));
      }, 1500);
    });
  }

  return {
    sttSupported,
    ttsSupported,
    startListening,
    speak,
    cancelSpeech,
    voices,
  };
}

function toDescriptor(v: SpeechSynthesisVoice): VoiceDescriptor {
  return {
    id: v.voiceURI,
    name: v.name,
    lang: v.lang,
    default: v.default,
  };
}
