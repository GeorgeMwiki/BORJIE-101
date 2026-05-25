/**
 * Waveform peaks generator + speaker-timeline builder.
 *
 * Data-only — no React, no DOM, no canvas. Output is shaped for
 * `wavesurfer.js` and `peaks.js` direct consumption.
 *
 * `generateWaveformPeaks(audio, resolution)` returns an array of
 * normalised-to-[0,1] peak amplitudes (RMS over each visual bucket).
 * Clients render bars / lines without any audio-decoding deps.
 *
 * `extractSpeakerTimeline(diarization)` maps a diarization timeline into
 * stably-coloured segments suitable for a swimlane / waveform overlay.
 */

import {
  AudioLogicsLitfinError,
  type AudioSample,
  type SpeakerTimelineSegment,
  type WaveformSpec,
} from '../types.js';

export interface GenerateWaveformPeaksOptions {
  /** Number of visual buckets (defaults to 200). */
  readonly resolution?: number;
}

/**
 * Compute one normalised peak per visual bucket over the audio bytes.
 * Stable for the same input bytes, useful for thumbnail rendering.
 *
 * @throws AudioLogicsLitfinError on empty audio or invalid resolution.
 */
export function generateWaveformPeaks(
  audio: AudioSample,
  options: GenerateWaveformPeaksOptions = {},
): WaveformSpec {
  if (audio.bytes.length === 0) {
    throw new AudioLogicsLitfinError('audio bytes empty', 'waveform-empty');
  }
  const resolution = options.resolution ?? 200;
  if (!Number.isInteger(resolution) || resolution <= 0) {
    throw new AudioLogicsLitfinError(
      `resolution must be a positive integer; got ${resolution}`,
      'waveform-bad-resolution',
    );
  }

  const bucketSize = Math.max(1, Math.floor(audio.bytes.length / resolution));
  const peaks: number[] = [];

  for (let bucket = 0; bucket < resolution; bucket++) {
    const start = bucket * bucketSize;
    const end = Math.min(audio.bytes.length, start + bucketSize);
    let sumSquares = 0;
    let n = 0;
    for (let i = start; i < end; i++) {
      const sample = ((audio.bytes[i] ?? 128) - 128) / 128; // [-1, 1] approx
      sumSquares += sample * sample;
      n++;
    }
    const rms = n === 0 ? 0 : Math.sqrt(sumSquares / n);
    peaks.push(Math.min(1, rms));
  }

  const durationMs =
    audio.durationMs ??
    Math.round((audio.bytes.length / (audio.sampleRate * 2 * audio.channels)) * 1000);

  return Object.freeze({
    peaks: Object.freeze(peaks),
    bucketCount: peaks.length,
    durationMs,
    sampleRate: audio.sampleRate,
  });
}

export interface DiarizationSegment {
  readonly speakerId: string;
  readonly speakerLabel?: string;
  readonly startMs: number;
  readonly endMs: number;
}

const SPEAKER_PALETTE: ReadonlyArray<string> = Object.freeze([
  '#3B82F6', // blue (primary tenant)
  '#10B981', // green (agent)
  '#F59E0B', // amber (third-party)
  '#EF4444', // red (alerted speaker)
  '#8B5CF6', // violet (manager)
  '#EC4899', // pink (witness)
  '#14B8A6', // teal
  '#F97316', // orange
]);

/**
 * Map a diarization stream into colored speaker-timeline segments. Same
 * speakerId always gets the same color (deterministic, palette-indexed
 * by first appearance).
 */
export function extractSpeakerTimeline(
  diarization: ReadonlyArray<DiarizationSegment>,
): ReadonlyArray<SpeakerTimelineSegment> {
  const palette = new Map<string, string>();
  const out: SpeakerTimelineSegment[] = [];

  for (const seg of diarization) {
    let color = palette.get(seg.speakerId);
    if (!color) {
      color = SPEAKER_PALETTE[palette.size % SPEAKER_PALETTE.length]!;
      palette.set(seg.speakerId, color);
    }
    out.push(
      Object.freeze({
        speakerId: seg.speakerId,
        speakerLabel: seg.speakerLabel ?? seg.speakerId,
        startMs: seg.startMs,
        endMs: seg.endMs,
        colorHex: color,
      }),
    );
  }

  return Object.freeze(out);
}
