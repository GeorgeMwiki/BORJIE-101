/**
 * Visible watermark overlay.
 *
 * Places the Borjie wordmark + signature gradient in the lower-right
 * corner of public-facing artefacts. For images, the production wiring
 * uses `sharp` to composite the wordmark PNG; for videos, ffmpeg's
 * `drawtext` / `overlay` filter chain.
 *
 * To keep the package install footprint minimal we define the surface
 * here as a pure planner — the planner returns the exact overlay
 * command and parameters; the production caller resolves `sharp` /
 * ffmpeg at runtime. Tests assert the planned parameters without
 * actually rendering the watermark.
 *
 * Pure logic. No native dependencies.
 *
 * @module @borjie/media-generation/watermark/visible-watermark
 */

import type { BrandSpec, MediaFormat } from '../types.js';

export interface VisibleWatermarkPlan {
  readonly format: MediaFormat;
  readonly wordmark_path: string;
  readonly position: 'lower_right' | 'upper_left';
  readonly opacity: number;
  /** Image overlay: sharp `composite` parameter shape. */
  readonly sharp_composite?: {
    readonly input: string;
    readonly gravity: string;
    readonly opacity: number;
  };
  /** Video overlay: ffmpeg filter complex string. */
  readonly ffmpeg_filter?: string;
}

export interface PlanWatermarkArgs {
  readonly format: MediaFormat;
  readonly brand: BrandSpec;
  readonly opacity?: number;
}

/**
 * Compute the overlay plan for a given format + brand spec. The
 * caller resolves the wordmark file at runtime and runs the rendering
 * pipeline (sharp / ffmpeg).
 */
export function planVisibleWatermark(
  args: PlanWatermarkArgs,
): VisibleWatermarkPlan {
  const opacity = args.opacity ?? 0.9;
  const wordmark = args.brand.wordmark_svg_path;
  if (args.format === 'image') {
    return {
      format: 'image',
      wordmark_path: wordmark,
      position: 'lower_right',
      opacity,
      sharp_composite: {
        input: wordmark,
        gravity: 'southeast',
        opacity,
      },
    };
  }
  // short_video + lipsync_video share the same ffmpeg overlay path.
  return {
    format: args.format,
    wordmark_path: wordmark,
    position: 'lower_right',
    opacity,
    ffmpeg_filter: buildFfmpegFilter(wordmark, opacity),
  };
}

function buildFfmpegFilter(wordmarkPath: string, opacity: number): string {
  // Position the wordmark at 24 px inset from the lower-right corner.
  // The opacity is applied via the format=rgba,colorchannelmixer pipe.
  return (
    `movie=${wordmarkPath},format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[wm];` +
    `[in][wm]overlay=W-w-24:H-h-24[out]`
  );
}

/**
 * Returns the file extension to associate with the watermarked
 * artifact. Used by the storage adapter so the bucket key is
 * predictable.
 */
export function watermarkedExtension(format: MediaFormat): string {
  switch (format) {
    case 'image':
      return 'wm.png';
    case 'short_video':
      return 'wm.mp4';
    case 'lipsync_video':
      return 'wm.mp4';
  }
}
