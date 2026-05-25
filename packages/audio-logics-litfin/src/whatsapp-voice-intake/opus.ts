/**
 * Opus → WAV conversion stub.
 *
 * Production: pipe through `ffmpeg` (already used elsewhere in the
 * monorepo) or `opus-tools`. Our pure-TS stub wraps the opus payload
 * inside a minimal 44-byte RIFF WAVE header so downstream STT adapters
 * that demand a WAV container can still consume the stream. The audio
 * content is unchanged — STT engines that recognise opus inside WAV
 * (e.g. Deepgram, AssemblyAI) work directly; STT engines that need
 * decoded PCM should swap in the ffmpeg adapter via `convertOpusToWav`.
 *
 * Pure function — no I/O, no native deps.
 */

import { AudioLogicsLitfinError } from '../types.js';

export interface ConvertOpusToWavOptions {
  readonly sampleRate?: 8000 | 16000 | 24000 | 48000;
  readonly channels?: 1 | 2;
}

/**
 * Wrap opus-coded bytes in a minimal 44-byte RIFF WAVE header so the
 * container layer of downstream STT adapters is happy. NOT a re-encode
 * — production deployments should use ffmpeg via the adapter port.
 *
 * @throws AudioLogicsLitfinError when input is empty.
 */
export function convertOpusToWav(
  opusBytes: Uint8Array,
  options: ConvertOpusToWavOptions = {},
): Uint8Array {
  if (opusBytes.length === 0) {
    throw new AudioLogicsLitfinError('opus payload empty', 'whatsapp-opus-empty');
  }
  const sampleRate = options.sampleRate ?? 16000;
  const channels = options.channels ?? 1;
  const dataLength = opusBytes.length;

  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);

  // "RIFF"
  view.setUint8(0, 0x52);
  view.setUint8(1, 0x49);
  view.setUint8(2, 0x46);
  view.setUint8(3, 0x46);
  view.setUint32(4, 36 + dataLength, true); // chunk size
  // "WAVE"
  view.setUint8(8, 0x57);
  view.setUint8(9, 0x41);
  view.setUint8(10, 0x56);
  view.setUint8(11, 0x45);
  // "fmt "
  view.setUint8(12, 0x66);
  view.setUint8(13, 0x6d);
  view.setUint8(14, 0x74);
  view.setUint8(15, 0x20);
  view.setUint32(16, 16, true); // subchunk1 size
  view.setUint16(20, 0x704F, true); // audio format 0x704F = Opus
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); // byte rate
  view.setUint16(32, channels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  // "data"
  view.setUint8(36, 0x64);
  view.setUint8(37, 0x61);
  view.setUint8(38, 0x74);
  view.setUint8(39, 0x61);
  view.setUint32(40, dataLength, true);

  const out = new Uint8Array(44 + dataLength);
  out.set(header, 0);
  out.set(opusBytes, 44);
  return out;
}

/**
 * Inverse — strip the 44-byte WAV header back off if present. Returns
 * the original bytes if no header is detected, so consumers can call
 * this defensively.
 */
export function extractOpusFromWav(wavBytes: Uint8Array): Uint8Array {
  if (wavBytes.length < 44) return wavBytes;
  // Quick check: "RIFF" + "WAVE"
  const isRiff =
    wavBytes[0] === 0x52 &&
    wavBytes[1] === 0x49 &&
    wavBytes[2] === 0x46 &&
    wavBytes[3] === 0x46 &&
    wavBytes[8] === 0x57 &&
    wavBytes[9] === 0x41 &&
    wavBytes[10] === 0x56 &&
    wavBytes[11] === 0x45;
  if (!isRiff) return wavBytes;
  return wavBytes.subarray(44);
}
