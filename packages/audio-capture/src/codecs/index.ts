/**
 * Codec helpers — small, dependency-free conversions that real adapters can
 * rely on without dragging libopus or libmp3 into the bundle.
 *
 * Heavy codecs (Opus/MP3) are implemented as *pluggable* runners; the default
 * runners synthesize byte-identical round-trips for tests, and production
 * deployments swap in `opus-recorder` / `lame.js` builds via `setOpusRunner`
 * / `setMp3Runner`.
 */

export {
  encodeOpus,
  decodeOpus,
  setOpusRunner,
  type OpusRunner,
} from './opus.js';
export {
  encodeMP3,
  setMp3Runner,
  type Mp3Runner,
} from './mp3.js';
export { encodeWAV, parseWAV } from './wav.js';
export {
  pcm16ToFloat32,
  float32ToPcm16,
  resampleAudio,
  type ResampleMode,
} from './pcm.js';
