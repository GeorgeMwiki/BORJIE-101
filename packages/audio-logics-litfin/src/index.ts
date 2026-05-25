/**
 * Public barrel for @borjie/audio-logics-litfin.
 *
 * Augments `@borjie/audio-capture` with 10 LITFIN-parity logics:
 *
 *   1. fingerprinting        — Shazam-style chromaprint + matcher
 *   2. biometrics            — voice enrollment + verification + liveness
 *   3. compliance-recording  — per-jurisdiction consent + notice
 *   4. evidence-chain        — C2PA-signed audio evidence manifests
 *   5. whatsapp-voice-intake — Meta Cloud API audio webhook bridge
 *   6. emotion-escalation    — anger / distress / crying triggers
 *   7. waveform-ui           — data-only waveform peaks + speaker timeline
 *   8. talk-time-meter       — per-minute talk-time metering
 *   9. quality-scoring       — PESQ-like MOS scoring
 *
 *   + factory: createAudioLogicsLitfin() composes everything with shared
 *              adapters and a single brain port.
 */

export * from './types.js';
export * from './fingerprinting/index.js';
export * from './biometrics/index.js';
export * from './compliance-recording/index.js';
export * from './evidence-chain/index.js';
export * from './whatsapp-voice-intake/index.js';
export * from './emotion-escalation/index.js';
export * from './waveform-ui/index.js';
export * from './talk-time-meter/index.js';
export * from './quality-scoring/index.js';
export {
  createAudioLogicsLitfin,
  type AudioLogicsLitfin,
  type CreateAudioLogicsLitfinOptions,
} from './factory.js';
