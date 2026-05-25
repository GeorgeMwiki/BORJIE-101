import { describe, expect, it, vi } from 'vitest';
import { createWhisperLocalAdapter } from '../../src/stt/whisper-local.js';
import { AudioCaptureError, type AudioChunk } from '../../src/types.js';

const audio = (): AudioChunk => ({
  bytes: new Uint8Array([1, 2, 3]),
  format: 'wav',
  sampleRate: 16000,
  channels: 1,
});

describe('createWhisperLocalAdapter', () => {
  it('reports the binary exit code as an AudioCaptureError', async () => {
    const spawn = vi.fn(async () => ({ stdout: '', stderr: 'no model', code: 1 }));
    const adapter = createWhisperLocalAdapter({ binPath: '/bin/whisper', spawn });
    await expect(
      adapter.transcribe({ audio: audio() }),
    ).rejects.toBeInstanceOf(AudioCaptureError);
  });

  it('parses whisper.cpp JSON into segments', async () => {
    const spawn = vi.fn(async () => ({
      stdout: JSON.stringify({
        transcription: [
          { text: ' good', offsets: { from: 0, to: 400 } },
          { text: ' morning', offsets: { from: 400, to: 900 } },
        ],
        language: 'en',
      }),
      stderr: '',
      code: 0,
    }));
    const adapter = createWhisperLocalAdapter({
      binPath: '/bin/whisper',
      modelPath: '/models/large-v3.bin',
      spawn,
    });
    const result = await adapter.transcribe({ audio: audio(), language: 'en' });
    expect(result.transcript).toContain('good');
    expect(result.transcript).toContain('morning');
    expect(result.segments).toHaveLength(2);
    expect(result.modelId).toBe('/models/large-v3.bin');
    expect(spawn).toHaveBeenCalledTimes(1);
    const args = spawn.mock.calls[0]?.[1] as ReadonlyArray<string>;
    expect(args).toContain('-l');
    expect(args).toContain('en');
  });

  it('rejects on malformed JSON output', async () => {
    const spawn = vi.fn(async () => ({ stdout: 'not-json', stderr: '', code: 0 }));
    const adapter = createWhisperLocalAdapter({ binPath: '/bin/whisper', spawn });
    await expect(adapter.transcribe({ audio: audio() })).rejects.toBeInstanceOf(
      AudioCaptureError,
    );
  });
});
