/**
 * Ambient declarations for the Web Speech API.
 *
 * The DOM lib in TS 5.x ships `SpeechSynthesis` types, but
 * `SpeechRecognition` is still experimental and only exposed via the
 * `webkitSpeechRecognition` prefix in some browsers. We declare the
 * minimum surface we use; widening these is safe.
 */

declare global {
  interface SpeechRecognitionEventResultAlternative {
    readonly transcript: string;
    readonly confidence: number;
  }

  interface SpeechRecognitionResult {
    readonly isFinal: boolean;
    readonly length: number;
    item(index: number): SpeechRecognitionEventResultAlternative;
    [index: number]: SpeechRecognitionEventResultAlternative;
  }

  interface SpeechRecognitionResultList {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
  }

  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string;
    readonly message: string;
  }

  interface SpeechRecognitionInstance extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    maxAlternatives: number;
    onresult: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEvent) => void) | null;
    onerror: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionErrorEvent) => void) | null;
    onend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
    onstart: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
  }

  interface SpeechRecognitionConstructor {
    new (): SpeechRecognitionInstance;
  }

  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export {};
