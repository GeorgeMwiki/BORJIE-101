/**
 * report-player-schema.ts — runtime + static shapes for the
 * ReportPlayer payload. Mirrors the gateway response from
 * GET /api/v1/mining/reports/:id/audio.
 */

import { z } from 'zod';

export const ChapterMarkerSchema = z.object({
  at: z.number().nonnegative(),
  label: z.string().min(1),
});

export const ReportAudioPayloadSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  audio_url: z.string().url(),
  transcript_url: z.string().url(),
  chapter_markers: z.array(ChapterMarkerSchema),
});

export type ChapterMarker = z.infer<typeof ChapterMarkerSchema>;
export type ReportAudioPayload = z.infer<typeof ReportAudioPayloadSchema>;
