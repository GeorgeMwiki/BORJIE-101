import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRealtimeSession } from '../../src/realtime/index.js';
import { createMockSTTAdapter } from '../../src/stt/mock.js';
import { createMockTTSAdapter } from '../../src/tts/mock.js';
import { createMockVAD } from '../../src/vad/mock.js';
import type { AudioChunk, BrainPort } from '../../src/types.js';

const audio = (seq: number, durationMs = 100): AudioChunk => ({
  bytes: new Uint8Array(64),
  format: 'pcm',
  sampleRate: 16000,
  channels: 1,
  durationMs,
  sequence: seq,
});

const makeBrain = (text: string): BrainPort => ({
  respond: vi.fn(async () => text),
});

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setImmediate(r));
  }
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('createRealtimeSession — VAD-driven turn-taking', () => {
  it('runs STT + brain + TTS exactly once per detected turn', async () => {
    const stt = createMockSTTAdapter({
      fixture: { transcript: 'rent due tomorrow' },
    });
    const tts = createMockTTSAdapter({ chunkCount: 3 });
    const vad = createMockVAD({ pattern: [true, true, false, false, false, false, false, false] });
    const brain = makeBrain('Acknowledged, sending reminder');

    const session = createRealtimeSession({
      stt,
      tts,
      vad,
      brain,
      voiceId: 'mwikila',
      options: { turnEndSilenceMs: 300 },
    });

    const transcripts: string[] = [];
    const responses: string[] = [];
    const chunks: AudioChunk[] = [];
    session.onTranscript((s) => {
      if (s.isFinal) transcripts.push(s.text);
    });
    session.onResponse((t) => responses.push(t));
    session.onSpeak((c) => chunks.push(c));

    for (let i = 0; i < 8; i += 1) {
      await session.send(audio(i, 100));
    }
    await flushMicrotasks();
    await session.end();

    expect(brain.respond).toHaveBeenCalledTimes(1);
    expect(transcripts).toContain('rent due tomorrow');
    expect(responses).toContain('Acknowledged, sending reminder');
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  it('records first-byte and end-to-end latency in metrics', async () => {
    const stt = createMockSTTAdapter({ fixture: { transcript: 'hi' } });
    const tts = createMockTTSAdapter({ chunkCount: 2 });
    const vad = createMockVAD({ pattern: [true, true, false, false, false, false] });
    const brain = makeBrain('ack');
    const session = createRealtimeSession({
      stt,
      tts,
      vad,
      brain,
      voiceId: 'v',
      options: { turnEndSilenceMs: 200 },
    });

    for (let i = 0; i < 6; i += 1) {
      await session.send(audio(i, 100));
    }
    await flushMicrotasks();
    await session.end();
    const metrics = session.metrics();
    expect(metrics.turns).toBe(1);
    expect(metrics.firstAudioByteLatencyMs).toHaveLength(1);
    expect(metrics.endToEndLatencyMs).toHaveLength(1);
    expect(metrics.firstAudioByteLatencyMs[0]).toBeGreaterThanOrEqual(0);
  });

  it('handles a barge-in interruption mid-TTS', async () => {
    const stt = createMockSTTAdapter({ fixture: { transcript: 'first turn' } });
    // Slow TTS — yields many small chunks with a microtask between each so we
    // can fire an interruption before the stream finishes.
    const ttsChunks: AudioChunk[] = [];
    const slowTts = {
      modelId: 'slow-mock',
      provider: 'slow-mock',
      synthesize: vi.fn(async () => {
        throw new Error('unused');
      }),
      streamSynthesize: async function* (): AsyncIterable<AudioChunk> {
        for (let i = 0; i < 20; i += 1) {
          // Yield to microtask queue so send() can interleave.
          await new Promise((r) => setImmediate(r));
          const c: AudioChunk = {
            bytes: new Uint8Array(4),
            format: 'mp3',
            sampleRate: 24000,
            channels: 1,
            sequence: i,
          };
          ttsChunks.push(c);
          yield c;
        }
      },
    };
    const vad = createMockVAD({
      pattern: [true, true, false, false, false, false, true, true, true],
    });
    const brain = makeBrain('long answer');

    const session = createRealtimeSession({
      stt,
      tts: slowTts,
      vad,
      brain,
      voiceId: 'v',
      options: { turnEndSilenceMs: 150, allowInterruptions: true },
    });

    let interruptionFired = false;
    session.onInterruption(() => {
      interruptionFired = true;
    });

    // Feed initial speech that triggers a turn.
    for (let i = 0; i < 6; i += 1) {
      await session.send(audio(i, 100));
    }
    // Let the TTS start streaming.
    await new Promise((r) => setImmediate(r));
    // Then send "speech" while TTS is in flight to trigger barge-in.
    for (let i = 6; i < 9; i += 1) {
      await session.send(audio(i, 100));
    }
    await flushMicrotasks();
    await session.end();

    expect(interruptionFired).toBe(true);
    expect(session.metrics().interruptions).toBe(1);
  });

  it('does not interrupt when allowInterruptions is false', async () => {
    const stt = createMockSTTAdapter({ fixture: { transcript: 'hi' } });
    const tts = {
      modelId: 'long-mock',
      provider: 'long-mock',
      synthesize: vi.fn(),
      streamSynthesize: async function* (): AsyncIterable<AudioChunk> {
        for (let i = 0; i < 4; i += 1) {
          await new Promise((r) => setImmediate(r));
          yield {
            bytes: new Uint8Array(4),
            format: 'mp3',
            sampleRate: 24000,
            channels: 1,
          };
        }
      },
    };
    const vad = createMockVAD({
      pattern: [true, true, false, false, false, false, true],
    });
    const brain = makeBrain('reply');
    const session = createRealtimeSession({
      stt,
      tts,
      vad,
      brain,
      voiceId: 'v',
      options: { allowInterruptions: false, turnEndSilenceMs: 150 },
    });
    let interrupted = false;
    session.onInterruption(() => {
      interrupted = true;
    });
    for (let i = 0; i < 7; i += 1) await session.send(audio(i, 100));
    await flushMicrotasks();
    await session.end();
    expect(interrupted).toBe(false);
  });

  it('subscribes and unsubscribes handlers via returned disposers', async () => {
    const stt = createMockSTTAdapter({ fixture: { transcript: 'x' } });
    const tts = createMockTTSAdapter();
    const vad = createMockVAD();
    const session = createRealtimeSession({
      stt,
      tts,
      vad,
      brain: makeBrain('ok'),
      voiceId: 'v',
    });
    let count = 0;
    const dispose = session.onTranscript(() => {
      count += 1;
    });
    dispose();
    // No transcripts yet — disposer should not throw and counter stays 0.
    expect(count).toBe(0);
  });
});
