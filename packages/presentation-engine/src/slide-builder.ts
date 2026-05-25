/**
 * Fluent slide builder.
 *
 * Provides the high-level `addTitleSlide`, `addBulletSlide`,
 * `addChartSlide`, `addImageSlide`, `addSectionDivider` API the spec
 * calls for. The builder accumulates an ordered list of slides; the
 * orchestrator hands them + a theme to the renderer.
 *
 * Immutability: each `add*` returns the same instance but mutates
 * internal state. Consumers that want immutable accumulation can
 * call `snapshot()` between additions.
 */

import type {
  Slide,
  BulletSlide,
  ChartSlide,
  ImageSlide,
  SectionDividerSlide,
  TitleSlide,
} from './types.js';

export class SlideBuilder {
  private slides: Slide[] = [];

  addTitleSlide(input: {
    readonly title: string;
    readonly subtitle?: string;
    readonly speakerNotes?: string;
  }): this {
    const slide: TitleSlide = {
      kind: 'title',
      title: input.title,
      ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
      ...(input.speakerNotes !== undefined
        ? { speakerNotes: input.speakerNotes }
        : {}),
    };
    this.slides.push(slide);
    return this;
  }

  addBulletSlide(input: {
    readonly title: string;
    readonly bullets: readonly string[];
    readonly speakerNotes?: string;
  }): this {
    const slide: BulletSlide = {
      kind: 'bullet',
      title: input.title,
      bullets: input.bullets,
      ...(input.speakerNotes !== undefined
        ? { speakerNotes: input.speakerNotes }
        : {}),
    };
    this.slides.push(slide);
    return this;
  }

  addChartSlide(input: {
    readonly title: string;
    readonly chartSpec: unknown;
    readonly chartPng?: Uint8Array;
    readonly caption?: string;
    readonly speakerNotes?: string;
  }): this {
    const slide: ChartSlide = {
      kind: 'chart',
      title: input.title,
      chartSpec: input.chartSpec,
      ...(input.chartPng !== undefined ? { chartPng: input.chartPng } : {}),
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(input.speakerNotes !== undefined
        ? { speakerNotes: input.speakerNotes }
        : {}),
    };
    this.slides.push(slide);
    return this;
  }

  addImageSlide(input: {
    readonly title?: string;
    readonly imagePng: Uint8Array;
    readonly caption?: string;
    readonly speakerNotes?: string;
  }): this {
    const slide: ImageSlide = {
      kind: 'image',
      imagePng: input.imagePng,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(input.speakerNotes !== undefined
        ? { speakerNotes: input.speakerNotes }
        : {}),
    };
    this.slides.push(slide);
    return this;
  }

  addSectionDivider(input: {
    readonly title: string;
    readonly subtitle?: string;
  }): this {
    const slide: SectionDividerSlide = {
      kind: 'section-divider',
      title: input.title,
      ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
    };
    this.slides.push(slide);
    return this;
  }

  /** Returns an immutable snapshot of the slides accumulated so far. */
  snapshot(): readonly Slide[] {
    return [...this.slides];
  }

  /** Length so callers can index `slideArtifacts` later. */
  get length(): number {
    return this.slides.length;
  }
}
