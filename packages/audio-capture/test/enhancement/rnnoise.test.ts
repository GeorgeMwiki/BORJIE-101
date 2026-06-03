import { describe, it, expect } from 'vitest';
import { createRnnoiseAdapter, type RnnoiseModule } from '../../src/enhancement/rnnoise.js';
import type { AudioChunk, EnhancementSpec } from '../../src/types.js';

function pcmChunk(samples: number[]): AudioChunk {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((s, i) => view.setInt16(i * 2, s, true));
  return { bytes, format: 'pcm', sampleRate: 16000, channels: 1 };
}

function spec(audio: AudioChunk, target: EnhancementSpec['target'] = 'denoise'): EnhancementSpec {
  return { audio, target };
}

describe('createRnnoiseAdapter (fallback noise-gate)', () => {
  it('reports the fallback provider when no WASM module is injected', () => {
    expect(createRnnoiseAdapter().provider).toBe('rnnoise-gate-fallback');
  });

  it('attenuates a quiet (sub-threshold) window', async () => {
    const adapter = createRnnoiseAdapter({ gateThreshold: 0.02 });
    // Tiny amplitudes -> RMS well below the gate -> attenuated.
    const quiet = new Array(320).fill(100); // ~0.003 amplitude
    const out = await adapter.enhance(spec(pcmChunk(quiet)));
    const view = new DataView(out.bytes.buffer, out.bytes.byteOffset, out.bytes.byteLength);
    // 100 * 0.1 gain = 10.
    expect(Math.abs(view.getInt16(0, true))).toBeLessThan(100);
  });

  it('passes a loud (speech-energy) window through', async () => {
    const adapter = createRnnoiseAdapter({ gateThreshold: 0.02 });
    const loud = new Array(320).fill(12000); // ~0.37 amplitude
    const out = await adapter.enhance(spec(pcmChunk(loud)));
    const view = new DataView(out.bytes.buffer, out.bytes.byteOffset, out.bytes.byteLength);
    expect(Math.abs(view.getInt16(0, true))).toBeGreaterThan(10000);
  });

  it('passes through unchanged for a non-denoise target', async () => {
    const adapter = createRnnoiseAdapter();
    const chunk = pcmChunk([12000, -12000]);
    const out = await adapter.enhance(spec(chunk, 'normalize'));
    expect(out).toBe(chunk);
  });

  it('rejects compressed formats', async () => {
    const adapter = createRnnoiseAdapter();
    const mp3: AudioChunk = { bytes: new Uint8Array([1, 2, 3, 4]), format: 'mp3', sampleRate: 16000, channels: 1 };
    await expect(adapter.enhance(spec(mp3))).rejects.toThrow();
  });
});

describe('createRnnoiseAdapter (injected WASM module)', () => {
  it('routes frames through the module and reports the wasm provider', async () => {
    const calls: number[] = [];
    const module: RnnoiseModule = {
      frameSize: 480,
      process: (frame) => {
        calls.push(frame.length);
        // Halve amplitude so we can assert the module ran.
        return frame.map((v) => v * 0.5);
      },
    };
    const adapter = createRnnoiseAdapter({ module });
    expect(adapter.provider).toBe('rnnoise-wasm');

    const samples = new Array(960).fill(20000); // 2 full frames @ 480
    const out = await adapter.enhance(spec(pcmChunk(samples)));
    const view = new DataView(out.bytes.buffer, out.bytes.byteOffset, out.bytes.byteLength);
    expect(view.getInt16(0, true)).toBeLessThan(20000);
    expect(calls.length).toBe(2);
    expect(calls[0]).toBe(480);
  });
});
