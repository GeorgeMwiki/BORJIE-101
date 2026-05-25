/**
 * Presentation orchestrator.
 *
 * Loads a template + theme, expands the template into a deck via the
 * slide builder, renders the deck to .pptx (via report-engine's
 * PPTX renderer with a theme override), and returns the buffer +
 * Piece-G-compatible slide artifacts.
 *
 * Templates here are deck-shaped (one slide per section) — distinct
 * from the document-oriented templates in report-engine, even though
 * the same `templateSlug` can name both flavours (Q3 strategy doc vs
 * Q3 strategy deck). The orchestrator picks the deck shape.
 */

import {
  renderReportPptx,
  type ReportDataAdapter,
  type ResolvedReportSection,
  type TenantBrandResolver,
  type ReportTemplateStore,
  type ReportTemplate,
  type ReportFormat,
} from '@borjie/report-engine';

import { SlideBuilder } from './slide-builder.js';
import { renderChartToPng } from './chart-render.js';
import { BUILT_IN_THEMES, type PresentationTheme } from './themes/built-in.js';
import type {
  RenderPresentationInput,
  RenderPresentationOutput,
  Slide,
  DeckSlideArtifact,
} from './types.js';
import { PresentationEngineError } from './types.js';

export interface PresentationOrchestratorDeps {
  readonly templateStore: ReportTemplateStore;
  readonly themeStore?: ThemeStore;
  readonly dataAdapter: ReportDataAdapter;
  readonly brandResolver: TenantBrandResolver;
  readonly clock?: () => Date;
}

export interface ThemeStore {
  readonly findBySlug: (input: {
    readonly tenantId: string;
    readonly slug: string;
  }) => Promise<PresentationTheme | null>;
}

export class InMemoryThemeStore implements ThemeStore {
  private readonly platform: Readonly<Record<string, PresentationTheme>>;
  private readonly tenantOverrides = new Map<string, PresentationTheme>();

  constructor(
    platform: Readonly<Record<string, PresentationTheme>> = BUILT_IN_THEMES,
  ) {
    this.platform = platform;
  }

  async findBySlug(input: {
    readonly tenantId: string;
    readonly slug: string;
  }): Promise<PresentationTheme | null> {
    const tenant = this.tenantOverrides.get(`${input.tenantId}:${input.slug}`);
    return tenant ?? this.platform[input.slug] ?? null;
  }

  registerTenantTheme(theme: PresentationTheme): void {
    if (theme.tenantId == null) {
      throw new Error('registerTenantTheme requires tenantId');
    }
    this.tenantOverrides.set(`${theme.tenantId}:${theme.slug}`, theme);
  }
}

export class PresentationOrchestrator {
  private readonly deps: PresentationOrchestratorDeps;

  constructor(deps: PresentationOrchestratorDeps) {
    this.deps = deps;
  }

  async renderPresentation(
    input: RenderPresentationInput,
  ): Promise<RenderPresentationOutput> {
    const themeStore = this.deps.themeStore ?? new InMemoryThemeStore();
    const theme = await themeStore.findBySlug({
      tenantId: input.tenantId,
      slug: input.themeSlug,
    });
    if (!theme) {
      throw new PresentationEngineError(
        `Theme not found: ${input.themeSlug}`,
        'THEME_NOT_FOUND',
      );
    }

    const template = await this.deps.templateStore.findBySlug({
      tenantId: input.tenantId,
      slug: input.templateSlug,
    });
    if (!template) {
      throw new PresentationEngineError(
        `Template not found: ${input.templateSlug}`,
        'TEMPLATE_NOT_FOUND',
      );
    }
    this.assertTemplateSupportsPptx(template);

    const brand = await this.deps.brandResolver.resolve(input.tenantId);

    const builder = new SlideBuilder();
    builder.addTitleSlide({
      title: template.displayNameEn,
      subtitle: brand.displayName,
    });

    const resolvedSections: ResolvedReportSection[] = [];
    for (const section of template.sections) {
      const resolved = await this.deps.dataAdapter.resolve({
        tenantId: input.tenantId,
        dataSource: section.data_source,
        params: input.params,
      });
      // Normalise the kind / title so renderer downstream gets consistent input.
      const normalised: ResolvedReportSection = {
        ...resolved,
        section_id: section.section_id,
        title: section.title,
        kind: section.kind,
      };
      resolvedSections.push(normalised);
      await this.appendSectionAsSlides(builder, normalised);
    }

    const clock = this.deps.clock ?? (() => new Date());
    const generatedAt = clock();

    const file = renderReportPptx({
      title: template.displayNameEn,
      subtitle: brand.displayName,
      sections: resolvedSections,
      brand,
      theme: theme.slideMaster,
      generatedAt,
    });

    const slides = builder.snapshot();
    const slideArtifacts = slides.map((s, i) =>
      slideToArtifact(s, i, theme.slug),
    );

    return {
      buffer: file.buffer,
      mimeType: file.mimeType,
      filename: file.filename,
      slideArtifacts,
    };
  }

  private assertTemplateSupportsPptx(template: ReportTemplate): void {
    const allowed = new Set<ReportFormat>(template.outputFormats);
    if (!allowed.has('pptx')) {
      throw new PresentationEngineError(
        `Template "${template.slug}" does not support pptx output`,
        'TEMPLATE_NOT_FOUND',
      );
    }
  }

  private async appendSectionAsSlides(
    builder: SlideBuilder,
    section: ResolvedReportSection,
  ): Promise<void> {
    if (section.kind === 'narrative') {
      builder.addBulletSlide({
        title: section.title,
        bullets: splitNarrativeIntoBullets(section.narrative ?? ''),
      });
    } else if (section.kind === 'table' && section.table) {
      builder.addBulletSlide({
        title: section.title,
        bullets: section.table.rows.map((row) =>
          (section.table?.headers ?? [])
            .map((h, i) => `${h}: ${String(row[i] ?? '')}`)
            .join(', '),
        ),
      });
    } else if (section.kind === 'kpi_grid' && section.kpi_grid) {
      builder.addBulletSlide({
        title: section.title,
        bullets: section.kpi_grid.metrics.map(
          (m) =>
            `${m.label}: ${m.value}${m.delta ? ` (${m.delta})` : ''}`,
        ),
      });
    } else if (section.kind === 'chart' && section.chart) {
      let png: Uint8Array;
      try {
        png =
          section.chart.png ??
          (await renderChartToPng({ spec: section.chart.spec }));
      } catch (err) {
        throw new PresentationEngineError(
          `Chart render failed for section "${section.section_id}"`,
          'CHART_RENDER_FAILURE',
          err,
        );
      }
      builder.addChartSlide({
        title: section.title,
        chartSpec: section.chart.spec,
        chartPng: png,
        ...(section.chart.title !== undefined
          ? { caption: section.chart.title }
          : {}),
      });
    }
  }
}

/** Break a paragraph into bullet-sized fragments. */
function splitNarrativeIntoBullets(text: string): readonly string[] {
  if (!text) return [];
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length === 0) return [text];
  return sentences;
}

function slideToArtifact(
  slide: Slide,
  index: number,
  themeSlug: string,
): DeckSlideArtifact {
  const base: DeckSlideArtifact = {
    componentType: 'deck_slide',
    slideIndex: index,
    slideKind: slide.kind,
    title: slide.title ?? '',
    themeSlug,
    ...(slide.speakerNotes !== undefined
      ? { speakerNotes: slide.speakerNotes }
      : {}),
  };
  if (slide.kind === 'title') {
    return { ...base, ...(slide.subtitle !== undefined ? { subtitle: slide.subtitle } : {}) };
  }
  if (slide.kind === 'bullet') {
    return { ...base, bullets: slide.bullets };
  }
  if (slide.kind === 'chart') {
    return {
      ...base,
      chartSpec: slide.chartSpec,
      ...(slide.caption !== undefined ? { caption: slide.caption } : {}),
    };
  }
  if (slide.kind === 'image') {
    return {
      ...base,
      imagePng: slide.imagePng,
      ...(slide.caption !== undefined ? { caption: slide.caption } : {}),
    };
  }
  // section-divider
  return {
    ...base,
    ...(slide.subtitle !== undefined ? { subtitle: slide.subtitle } : {}),
  };
}

export function createPresentationOrchestrator(
  deps: PresentationOrchestratorDeps,
): PresentationOrchestrator {
  return new PresentationOrchestrator(deps);
}
