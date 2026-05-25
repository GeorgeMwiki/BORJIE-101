/**
 * Minimal RIFF/WAVE encoder + parser. PCM16 mono/stereo, 8/16/24/44.1/48 kHz.
 *
 * We keep this small (no deps) since it's the canonical container we use to
 * shuttle raw audio between adapters and tests.
 */

export interface WavMeta {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: 16;
}

export function encodeWAV(pcm: Uint8Array, meta: WavMeta): Uint8Array {
  const byteRate = meta.sampleRate * meta.channels * 2;
  const blockAlign = meta.channels * 2;
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;
  const writeAscii = (s: string) => {
    for (const ch of s) {
      view.setUint8(offset, ch.charCodeAt(0));
      offset += 1;
    }
  };
  writeAscii('RIFF');
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeAscii('WAVE');
  writeAscii('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true); // PCM
  offset += 2;
  view.setUint16(offset, meta.channels, true);
  offset += 2;
  view.setUint32(offset, meta.sampleRate, true);
  offset += 4;
  view.setUint32(offset, byteRate, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, 16, true); // bits per sample
  offset += 2;
  writeAscii('data');
  view.setUint32(offset, dataSize, true);
  offset += 4;
  new Uint8Array(buffer, 44).set(pcm);
  return new Uint8Array(buffer);
}

export interface ParsedWav extends WavMeta {
  readonly pcm: Uint8Array;
}

export function parseWAV(wav: Uint8Array): ParsedWav {
  if (wav.byteLength < 44) throw new Error('wav too short');
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const fmtSampleRate = view.getUint32(24, true);
  const fmtChannels = view.getUint16(22, true);
  const bitsPerSample = view.getUint16(34, true);
  if (bitsPerSample !== 16) {
    throw new Error(`unsupported bitsPerSample=${bitsPerSample}`);
  }
  return {
    sampleRate: fmtSampleRate,
    channels: fmtChannels,
    bitsPerSample: 16,
    pcm: wav.slice(44),
  };
}
