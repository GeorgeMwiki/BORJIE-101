/**
 * HomeComposer — sticky bottom composer for HomeShell.
 *
 * Renderer-pure; sends via the supplied onSend callback. Honours
 * Enter-to-send, Shift+Enter for newline. Disabled while streaming.
 *
 * Voice STT: a press-to-talk mic toggle that streams interim
 * transcripts straight into the textarea via the Web Speech API
 * (`SpeechRecognition` / `webkitSpeechRecognition`). The interim
 * transcript appends live; the final transcript replaces the interim
 * slice and stops the session. Locale-aware (sw-TZ vs en-TZ vs fr-FR).
 *
 * Fallback: when the browser lacks SpeechRecognition, the mic press
 * surfaces a small one-shot toast ("Voice not supported in this
 * browser" / "Sauti haitumiki kwenye kivinjari hiki" / French equivalent)
 * for ~3s; the textarea is unaffected.
 *
 * Spec: HOME_DASHBOARD_STANDARD §8.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createWebSpeechAudioPort } from '../voice/web-speech-adapter.js';
import type {
  ListeningHandle,
  VoiceAudioPort,
} from '../voice/voice-audio-port.js';

export type HomeComposerLanguage = 'en' | 'sw' | 'fr';

export interface HomeComposerProps {
  readonly onSend: (text: string) => void | Promise<void>;
  readonly disabled: boolean;
  readonly placeholder: string;
  readonly testId?: string | undefined;
  /** Drives recognition locale (sw-TZ / en-TZ / fr-FR). Defaults to 'en'. */
  readonly language?: HomeComposerLanguage;
}

const WRAPPER_STYLE: CSSProperties = {
  position: 'sticky',
  bottom: 0,
  left: 0,
  right: 0,
  padding: '12px 16px',
  background: 'var(--color-background, #ffffff)',
  borderTop: '1px solid var(--color-border, #e5e7eb)',
  display: 'flex',
  gap: 8,
  alignItems: 'flex-end',
};

const TEXTAREA_STYLE: CSSProperties = {
  flex: 1,
  resize: 'none',
  minHeight: 44,
  maxHeight: 160,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--color-border, #e5e7eb)',
  fontFamily: 'inherit',
  fontSize: 14,
  lineHeight: 1.5,
  background: 'var(--color-background, #ffffff)',
  color: 'var(--color-foreground, #0f172a)',
};

const BUTTON_STYLE: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 10,
  border: 'none',
  background: 'linear-gradient(135deg, #C9A66B 0%, #8B6914 100%)',
  color: '#17100A',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const MIC_BUTTON_STYLE_BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 44,
  height: 44,
  borderRadius: 10,
  border: '1px solid var(--color-border, #e5e7eb)',
  background: 'var(--color-background, #ffffff)',
  color: 'var(--color-foreground, #0f172a)',
  cursor: 'pointer',
  flexShrink: 0,
};

const MIC_BUTTON_STYLE_RECORDING: CSSProperties = {
  ...MIC_BUTTON_STYLE_BASE,
  background: '#FEE2E2',
  borderColor: '#DC2626',
  color: '#991B1B',
};

const TOAST_STYLE: CSSProperties = {
  position: 'absolute',
  bottom: 70,
  left: 16,
  background: 'rgba(15, 23, 42, 0.92)',
  color: '#FFFFFF',
  fontSize: 12,
  padding: '8px 12px',
  borderRadius: 8,
  pointerEvents: 'none',
};

function bcp47ForLanguage(lang: HomeComposerLanguage): string {
  if (lang === 'sw') return 'sw-TZ';
  if (lang === 'fr') return 'fr-FR';
  return 'en-TZ';
}

function unsupportedToastText(lang: HomeComposerLanguage): string {
  if (lang === 'sw') return 'Sauti haitumiki kwenye kivinjari hiki.';
  if (lang === 'fr') return "La voix n'est pas prise en charge dans ce navigateur.";
  return 'Voice not supported in this browser.';
}

function micLabel(
  lang: HomeComposerLanguage,
  isRecording: boolean,
): string {
  if (lang === 'sw') {
    return isRecording ? 'Acha kurekodi' : 'Anza kurekodi sauti';
  }
  if (lang === 'fr') {
    return isRecording ? "Arrêter l'enregistrement" : 'Démarrer la dictée vocale';
  }
  return isRecording ? 'Stop recording' : 'Start voice input';
}

export function HomeComposer(props: HomeComposerProps): JSX.Element {
  const {
    onSend,
    disabled,
    placeholder,
    testId = 'home-composer',
    language = 'en',
  } = props;
  const [value, setValue] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const listeningHandleRef = useRef<ListeningHandle | null>(null);
  const interimBaselineRef = useRef<string>('');

  const port: VoiceAudioPort = useMemo(
    () =>
      createWebSpeechAudioPort({
        recognitionLang: bcp47ForLanguage(language),
        continuous: false,
      }),
    [language],
  );

  // Auto-dismiss the unsupported-toast after 3s.
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Tidy up listening on unmount.
  useEffect(
    () => () => {
      listeningHandleRef.current?.stop();
      listeningHandleRef.current = null;
    },
    [],
  );

  const stopRecording = useCallback(() => {
    listeningHandleRef.current?.stop();
    listeningHandleRef.current = null;
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(() => {
    if (!port.sttSupported) {
      setToast(unsupportedToastText(language));
      return;
    }
    // Anchor the existing draft so interim chunks append rather than
    // clobber what the owner already typed.
    interimBaselineRef.current = value;
    try {
      const handle = port.startListening((result) => {
        const transcript = result.transcript ?? '';
        const baseline = interimBaselineRef.current;
        const composed = baseline
          ? `${baseline}${baseline.endsWith(' ') ? '' : ' '}${transcript}`
          : transcript;
        setValue(composed);
        if (result.isFinal) {
          interimBaselineRef.current = composed;
        }
      });
      listeningHandleRef.current = handle;
      setIsRecording(true);
    } catch {
      setIsRecording(false);
      setToast(unsupportedToastText(language));
    }
  }, [port, language, value]);

  const toggleRecording = useCallback(() => {
    if (isRecording) stopRecording();
    else startRecording();
  }, [isRecording, startRecording, stopRecording]);

  const submit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    // Always stop the mic on send so we never ship a half-recorded chunk.
    if (isRecording) stopRecording();
    setValue('');
    interimBaselineRef.current = '';
    await onSend(trimmed);
  }, [value, disabled, onSend, isRecording, stopRecording]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void submit();
      }
    },
    [submit],
  );

  const micStyle = isRecording
    ? MIC_BUTTON_STYLE_RECORDING
    : MIC_BUTTON_STYLE_BASE;
  const micAriaLabel = micLabel(language, isRecording);

  return (
    <div data-testid={testId} style={{ ...WRAPPER_STYLE, position: 'relative' }}>
      {toast ? (
        <div data-testid="home-composer-toast" role="status" style={TOAST_STYLE}>
          {toast}
        </div>
      ) : null}
      <button
        type="button"
        data-testid="home-composer-mic"
        onClick={toggleRecording}
        disabled={disabled}
        aria-label={micAriaLabel}
        aria-pressed={isRecording}
        title={micAriaLabel}
        style={micStyle}
      >
        <MicIcon recording={isRecording} />
      </button>
      <textarea
        data-testid="home-composer-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        style={TEXTAREA_STYLE}
        rows={1}
      />
      <button
        type="button"
        data-testid="home-composer-send"
        onClick={() => void submit()}
        disabled={disabled || value.trim().length === 0}
        style={BUTTON_STYLE}
      >
        Send
      </button>
    </div>
  );
}

function MicIcon({ recording }: { readonly recording: boolean }): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
      {recording ? (
        <circle cx="20" cy="4" r="2.5" fill="#DC2626" stroke="none">
          <animate
            attributeName="opacity"
            values="1;0.3;1"
            dur="1s"
            repeatCount="indefinite"
          />
        </circle>
      ) : null}
    </svg>
  );
}
