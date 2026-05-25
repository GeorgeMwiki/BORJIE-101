/**
 * Public types for the presentation-engine.
 *
 * High-level shape:
 *   - Deck         : ordered list of slides + theme + brand context
 *   - Slide        : tagged-union of kinds (title, bullet, chart, image, section-divider)
 *   - DeckArtifact : Piece G `ui_artifacts.component_type='deck_slide'`
 *                    compatible representation, so downstream rendering
 *                    in the UI can reuse the same data shape
 */

import type { TenantBrand } from '@borjie/report-engine';
import type { PresentationTheme } from './themes/built-in.js';

export type SlideKind =
  | 'title'
  | 'bullet'
  | 'chart'
  | 'image'
  | 'section-divider';

export interface SlideBase {
  readonly kind: SlideKind;
  readonly title?: string;
  readonly speakerNotes?: string;
}

export interface TitleSlide extends SlideBase {
  readonly kind: 'title';
  readonly title: string;
  readonly subtitle?: string;
}

export interface BulletSlide extends SlideBase {
  readonly kind: 'bullet';
  readonly title: string;
  readonly bullets: readonly string[];
}

export interface ChartSlide extends SlideBase {
  readonly kind: 'chart';
  readonly title: string;
  /** Vega-Lite spec; renderer adapter pre-renders to PNG if needed. */
  readonly chartSpec: unknown;
  /** Optional pre-rendered chart PNG (Uint8Array). */
  readonly chartPng?: Uint8Array;
  /** Optional textual caption rendered under the chart. */
  readonly caption?: string;
}

export interface ImageSlide extends SlideBase {
  readonly kind: 'image';
  readonly title?: string;
  readonly imagePng: Uint8Array;
  readonly caption?: string;
}

export interface SectionDividerSlide extends SlideBase {
  readonly kind: 'section-divider';
  readonly title: string;
  readonly subtitle?: string;
}

export type Slide =
  | TitleSlide
  | BulletSlide
  | ChartSlide
  | ImageSlide
  | SectionDividerSlide;

/** One presentation. */
export interface Deck {
  readonly slides: readonly Slide[];
  readonly theme: PresentationTheme;
  readonly brand: TenantBrand;
}

/**
 * Piece G compatibility — slide-shaped JSON payload that maps onto
 * `ui_artifacts.component_type='deck_slide'`. The presentation engine
 * emits one of these per slide so the same data flows into the
 * conversational UI without re-renderering the .pptx.
 *
 * NOTE: Piece G's exact schema lands separately. We use a
 * conservative shape that the merging consumer can re-key trivially.
 */
export interface DeckSlideArtifact {
  readonly componentType: 'deck_slide';
  readonly slideIndex: number;
  readonly slideKind: SlideKind;
  readonly title: string;
  readonly bullets?: readonly string[];
  readonly chartSpec?: unknown;
  readonly imagePng?: Uint8Array;
  readonly caption?: string;
  readonly subtitle?: string;
  readonly speakerNotes?: string;
  readonly themeSlug: string;
}

export interface RenderPresentationInput {
  readonly tenantId: string;
  readonly templateSlug: string;
  readonly themeSlug: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface RenderPresentationOutput {
  readonly buffer: Buffer;
  readonly mimeType: string;
  readonly filename: string;
  readonly slideArtifacts: readonly DeckSlideArtifact[];
}

export class PresentationEngineError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'THEME_NOT_FOUND'
      | 'TEMPLATE_NOT_FOUND'
      | 'CHART_RENDER_FAILURE',
    public override readonly cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'PresentationEngineError';
  }
}
