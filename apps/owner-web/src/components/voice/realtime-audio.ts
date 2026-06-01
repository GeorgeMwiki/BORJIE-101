'use client';

/**
 * realtime-audio.ts — low-level Web Audio plumbing for the realtime-duplex
 * voice client (`use-realtime-voice`).
 *
 * Two concerns, both browser-only:
 *   1. MicCapture — getUserMedia → AudioContext → ScriptProcessor tap that
 *      emits mono 16-bit PCM frames plus a per-frame RMS energy reading
 *      (used for client-side barge-in / voice-activity detection).
 *   2. PcmPlayer — queues model-returned PCM16 frames and plays them back
 *      gaplessly through a single AudioContext, with a hard `stop()` for
 *      barge-in.
 *
 * The gateway voice WS is NOT live in this environment, so the wire
 * sample rate is an ASSUMPTION (24 kHz mono PCM16 little-endian — the de
 * facto realtime-speech default). It is exposed as a constant so a single
 * edit re-tunes both capture and playback once the contract is pinned.
 *
 * Discipline:
 *   - Immutable frame objects; no input mutation.
 *   - <50 lines per function; nesting <4.
 *   - No console.log — callers receive errors via the `onError` callback.
 *   - ScriptProcessorNode is deprecated but universally available and
 *     needs no cross-origin worklet module (which we cannot ship here);
 *     swap to an AudioWorklet once the endpoint + module path are real.
 */

/** Assumed wire format for the gateway voice WS — re-tune in one place. */
export const VOICE_SAMPLE_RATE_HZ = 24_000;
const CAPTURE_BUFFER_FRAMES = 2_048;

/** A single captured microphone frame handed up to the transport. */
export interface MicFrame {
  /** Mono 16-bit little-endian PCM, ready to send as a binary WS message. */
  readonly pcm: ArrayBuffer;
  /** Root-mean-square energy of the frame in [0, 1]; drives barge-in VAD. */
  readonly rms: number;
}

export interface MicCaptureHandlers {
  readonly onFrame: (frame: MicFrame) => void;
  readonly onError: (code: string) => void;
}

type WindowAudioCtor = typeof AudioContext;

function resolveAudioContextCtor(): WindowAudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: WindowAudioCtor;
    webkitAudioContext?: WindowAudioCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** True when getUserMedia + AudioContext are both reachable in this runtime. */
export function isRealtimeAudioSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  const hasMedia = Boolean(navigator.mediaDevices?.getUserMedia);
  return hasMedia && resolveAudioContextCtor() !== null;
}

/** Convert a Float32 [-1, 1] buffer to little-endian PCM16, returning RMS too. */
function floatToPcm16(input: Float32Array): MicFrame {
  const out = new DataView(new ArrayBuffer(input.length * 2));
  let sumSquares = 0;
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]!));
    sumSquares += sample * sample;
    out.setInt16(i * 2, Math.round(sample * 0x7fff), true);
  }
  const rms = input.length > 0 ? Math.sqrt(sumSquares / input.length) : 0;
  return { pcm: out.buffer, rms };
}

/** Decode an inbound PCM16 little-endian buffer to a Float32 [-1, 1] view. */
function pcm16ToFloat(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const out = new Float32Array(Math.floor(buffer.byteLength / 2));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return out;
}

/**
 * Microphone capture pump. `start()` requests the mic and begins emitting
 * `MicFrame`s; `stop()` tears down every node and releases the track.
 */
export class MicCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  constructor(private readonly handlers: MicCaptureHandlers) {}

  async start(): Promise<void> {
    const Ctor = resolveAudioContextCtor();
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      this.handlers.onError('audio_unsupported');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.handlers.onError('mic_permission_denied');
      return;
    }
    this.wireGraph(new Ctor({ sampleRate: VOICE_SAMPLE_RATE_HZ }));
  }

  private wireGraph(context: AudioContext): void {
    this.context = context;
    this.source = context.createMediaStreamSource(this.stream!);
    this.processor = context.createScriptProcessor(CAPTURE_BUFFER_FRAMES, 1, 1);
    this.processor.onaudioprocess = (event) => {
      const channel = event.inputBuffer.getChannelData(0);
      this.handlers.onFrame(floatToPcm16(channel));
    };
    this.source.connect(this.processor);
    // ScriptProcessor only fires while connected to a destination.
    this.processor.connect(context.destination);
  }

  stop(): void {
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
      this.stream?.getTracks().forEach((track) => track.stop());
      void this.context?.close();
    } catch {
      /* teardown best-effort — nodes may already be detached */
    }
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.context = null;
  }
}

/**
 * Gapless PCM16 playback queue. `enqueue()` schedules a frame after the
 * previously queued audio; `stop()` halts and flushes everything for
 * barge-in. `onIdle` fires when the queue drains.
 */
export class PcmPlayer {
  private context: AudioContext | null = null;
  private nextStartAt = 0;
  private pending = 0;

  constructor(private readonly onIdle: () => void) {}

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    const Ctor = resolveAudioContextCtor();
    if (!Ctor) return null;
    this.context = new Ctor({ sampleRate: VOICE_SAMPLE_RATE_HZ });
    this.nextStartAt = this.context.currentTime;
    return this.context;
  }

  enqueue(buffer: ArrayBuffer): void {
    const context = this.ensureContext();
    if (!context) return;
    const floats = pcm16ToFloat(buffer);
    if (floats.length === 0) return;
    const audioBuffer = context.createBuffer(1, floats.length, VOICE_SAMPLE_RATE_HZ);
    // `set` (vs copyToChannel) avoids the strict ArrayBuffer-variance check
    // on the decoded Float32 view and is equivalent for a mono channel.
    audioBuffer.getChannelData(0).set(floats);
    const node = context.createBufferSource();
    node.buffer = audioBuffer;
    node.connect(context.destination);
    const startAt = Math.max(this.nextStartAt, context.currentTime);
    this.pending += 1;
    node.onended = () => {
      this.pending = Math.max(0, this.pending - 1);
      if (this.pending === 0) this.onIdle();
    };
    node.start(startAt);
    this.nextStartAt = startAt + audioBuffer.duration;
  }

  /** True while at least one frame is scheduled or playing. */
  isPlaying(): boolean {
    return this.pending > 0;
  }

  stop(): void {
    this.pending = 0;
    try {
      void this.context?.close();
    } catch {
      /* already closed */
    }
    this.context = null;
    this.nextStartAt = 0;
  }
}
