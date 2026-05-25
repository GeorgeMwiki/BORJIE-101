/**
 * Audio quality / PESQ-like scoring.
 *
 * Full ITU-T P.862 (PESQ) / P.863 (POLQA) implementations are licensed
 * commercial software (Opticom). We approximate the *qualitative* signal
 * those scores produce — MOS in [1..5] — from three open inputs:
 *
 *   1. SNR (dB)              — short-time energy ratio of speech vs noise
 *   2. clipping fraction      — share of samples saturated near +/- max
 *   3. effective bandwidth    — wideband (16 kHz+) vs narrowband (8 kHz)
 *
 * Heuristic mapping (calibrated against POLQA paper reference values):
 *   MOS = 5 * sigmoid(snrDb / 12)
 *           - 1.5 * clippingFraction
 *           - (bandwidth < 8 kHz ? 0.8 : bandwidth < 16 kHz ? 0.3 : 0)
 *   clamped to [1, 5].
 *
 * Sources cited in Docs/AUDIO_LOGICS_LITFIN_RESEARCH_2026-05-25.md.
 */

import {
  AudioLogicsLitfinError,
  type AudioSample,
  type QualityScore,
} from '../types.js';

const NARROWBAND_HZ = 8000;
const WIDEBAND_HZ = 16000;
const CLIPPING_THRESHOLD = 250; // PCM unsigned-8 saturation boundary
const SILENT_AVG_THRESHOLD = 2; // mean amplitude below this → silent
const MIN_ACCEPTABLE_MOS = 2.5;

export function scoreAudioQuality(audio: AudioSample): QualityScore {
  if (audio.bytes.length === 0) {
    throw new AudioLogicsLitfinError('audio bytes empty', 'quality-empty');
  }

  const { snrDb, meanAmp } = computeSnr(audio.bytes);
  const clippingFraction = computeClippingFraction(audio.bytes);
  const bandwidthHz = effectiveBandwidth(audio.sampleRate);

  const sigmoid = 1 / (1 + Math.exp(-snrDb / 12));
  let mosLike = 5 * sigmoid - 1.5 * clippingFraction;
  if (bandwidthHz < NARROWBAND_HZ) mosLike -= 0.8;
  else if (bandwidthHz < WIDEBAND_HZ) mosLike -= 0.3;
  mosLike = Math.max(1, Math.min(5, mosLike));

  const issues: QualityScore['issues'][number][] = [];
  if (snrDb < 10) issues.push('low-snr');
  if (clippingFraction > 0.05) issues.push('heavy-clipping');
  if (bandwidthHz < NARROWBAND_HZ) issues.push('narrowband-only');
  if (meanAmp < SILENT_AVG_THRESHOLD) issues.push('silent');
  if (audio.channels === 1 && bandwidthHz < WIDEBAND_HZ) {
    issues.push('mono-channel-loss');
  }

  return Object.freeze({
    mosLike,
    snrDb,
    clippingFraction,
    bandwidthHz,
    acceptableForEvidence: mosLike >= MIN_ACCEPTABLE_MOS && !issues.includes('silent'),
    issues: Object.freeze(issues),
  });
}

function computeSnr(bytes: Uint8Array): { snrDb: number; meanAmp: number } {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    sum += Math.abs((bytes[i] ?? 128) - 128);
  }
  const meanAmp = sum / bytes.length;

  let sigEnergy = 0;
  let noiseEnergy = 0;
  for (let i = 0; i < bytes.length; i++) {
    const sample = Math.abs((bytes[i] ?? 128) - 128);
    if (sample > meanAmp) sigEnergy += sample * sample;
    else noiseEnergy += sample * sample;
  }
  if (noiseEnergy <= 0) return { snrDb: 60, meanAmp };
  if (sigEnergy <= 0) return { snrDb: -20, meanAmp };
  const ratio = sigEnergy / noiseEnergy;
  return { snrDb: 10 * Math.log10(ratio), meanAmp };
}

function computeClippingFraction(bytes: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 128;
    if (b >= CLIPPING_THRESHOLD || b <= 255 - CLIPPING_THRESHOLD) n++;
  }
  return n / bytes.length;
}

function effectiveBandwidth(sampleRate: AudioSample['sampleRate']): number {
  // Bandwidth approx half the sample rate (Nyquist).
  return Math.floor(sampleRate / 2);
}
