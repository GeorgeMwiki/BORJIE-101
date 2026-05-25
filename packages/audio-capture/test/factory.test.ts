import { describe, expect, it } from 'vitest';
import { createAudioCapture } from '../src/factory.js';
import { createMockSTTAdapter } from '../src/stt/mock.js';
import { createMockTTSAdapter } from '../src/tts/mock.js';
import { createMockVAD } from '../src/vad/mock.js';
import { createMockDiarization } from '../src/diarization/mock.js';
import { createMockEnhancement } from '../src/enhancement/mock.js';

describe('createAudioCapture', () => {
  it('exposes nulls when no subsystems are wired', () => {
    const capture = createAudioCapture();
    expect(capture.stt).toBeNull();
    expect(capture.tts).toBeNull();
    expect(capture.vad).toBeNull();
    expect(capture.diarization).toBeNull();
    expect(capture.enhancement).toBeNull();
    expect(capture.brain).toBeNull();
  });

  it('throws when starting realtime without required ports', () => {
    const capture = createAudioCapture();
    expect(() => capture.startRealtimeSession()).toThrow();
  });

  it('starts a realtime session when stt + tts + vad + brain are present', () => {
    const capture = createAudioCapture({
      stt: createMockSTTAdapter({ fixture: { transcript: 'hi' } }),
      tts: createMockTTSAdapter(),
      vad: createMockVAD(),
      diarization: createMockDiarization(),
      enhancement: createMockEnhancement(),
      brain: { respond: async () => 'ok' },
      defaultVoiceId: 'mwikila',
    });
    const session = capture.startRealtimeSession();
    expect(session.sessionId).toBeDefined();
    expect(typeof session.send).toBe('function');
  });
});
