import { describe, expect, it } from 'vitest';
import { normaliseToLufs, rmsDbfs } from '../../src/enhancement/loudness.js';
import type { AudioChunk } from '../../src/types.js';

const makeChunk = (amp: number): AudioChunk => {
  const samples = new Int16Array(2048);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.sin((i / samples.length) * 2 * Math.PI * 50) * amp;
  }
  return {
    bytes: new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
    format: 'pcm',
    sampleRate: 16000,
    channels: 1,
  };
};

describe('loudness', () => {
  it('rmsDbfs returns -Infinity for an empty buffer', () => {
    expect(rmsDbfs(new Float32Array(0))).toBe(-Infinity);
  });

  it('normaliseToLufs scales a quiet signal closer to the target', () => {
    const quiet = makeChunk(1000);
    const normalized = normaliseToLufs(quiet, -23);

    const before = pcmDbfs(quiet);
    const after = pcmDbfs(normalized);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeCloseTo(-23, 0);
  });

  it('returns the chunk untouched when input is silence', () => {
    const silence: AudioChunk = {
      bytes: new Uint8Array(64),
      format: 'pcm',
      sampleRate: 16000,
      channels: 1,
    };
    const out = normaliseToLufs(silence);
    expect(out).toBe(silence);
  });
});

function pcmDbfs(chunk: AudioChunk): number {
  const view = new DataView(
    chunk.bytes.buffer,
    chunk.bytes.byteOffset,
    chunk.bytes.byteLength,
  );
  const samples = new Float32Array(Math.floor(chunk.bytes.byteLength / 2));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }
  return rmsDbfs(samples);
}
