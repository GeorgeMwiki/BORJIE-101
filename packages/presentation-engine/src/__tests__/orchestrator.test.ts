/**
 * Presentation orchestrator end-to-end tests.
 *
 * Renders Q3 strategy in all 5 themes; asserts valid .pptx output
 * and slide-artifact compatibility with Piece G's ui_artifacts shape.
 */

import { describe, it, expect } from 'vitest';
import {
  createPresentationOrchestrator,
  InMemoryThemeStore,
  BUILT_IN_THEMES,
  PresentationEngineError,
  type DeckSlideArtifact,
} from '../index.js';
import {
  InMemoryReportTemplateStore,
  createDevDataAdapter,
  type TenantBrand,
} from '@borjie/report-engine';

const STUB_BRAND: TenantBrand = {
  displayName: 'Acme PM',
  primaryColor: '#1F3864',
  accentColor: '#FFC000',
};

function build() {
  return createPresentationOrchestrator({
    templateStore: new InMemoryReportTemplateStore(),
    themeStore: new InMemoryThemeStore(),
    dataAdapter: createDevDataAdapter(),
    brandResolver: { resolve: async () => STUB_BRAND },
    clock: () => new Date('2026-05-22T00:00:00Z'),
  });
}

function isZip(buffer: Buffer): boolean {
  return (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

describe('PresentationOrchestrator', () => {
  const themeSlugs = Object.keys(BUILT_IN_THEMES);

  for (const themeSlug of themeSlugs) {
    it(`renders Q3 strategy with theme "${themeSlug}"`, async () => {
      const orchestrator = build();
      const out = await orchestrator.renderPresentation({
        tenantId: 'tenant-1',
        templateSlug: 'q3_strategy',
        themeSlug,
        params: { period: 'Q3 2026' },
      });
      expect(isZip(out.buffer)).toBe(true);
      expect(out.buffer.length).toBeGreaterThan(500);
      expect(out.mimeType).toMatch(/presentationml/);
      expect(out.filename.endsWith('.pptx')).toBe(true);
      expect(out.slideArtifacts.length).toBeGreaterThan(0);
      // Each artifact must carry the theme slug.
      for (const art of out.slideArtifacts) {
        expect(art.themeSlug).toBe(themeSlug);
      }
    });
  }

  it('throws THEME_NOT_FOUND when the theme is unknown', async () => {
    const orchestrator = build();
    let caught: unknown;
    try {
      await orchestrator.renderPresentation({
        tenantId: 't1',
        templateSlug: 'q3_strategy',
        themeSlug: 'no_such_theme',
        params: {},
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PresentationEngineError);
    expect((caught as PresentationEngineError).code).toBe('THEME_NOT_FOUND');
  });

  it('throws TEMPLATE_NOT_FOUND for unknown template slug', async () => {
    const orchestrator = build();
    let caught: unknown;
    try {
      await orchestrator.renderPresentation({
        tenantId: 't1',
        templateSlug: 'no_such',
        themeSlug: 'classic_corporate',
        params: {},
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PresentationEngineError);
  });

  it('produces a title slide + section slides', async () => {
    const orchestrator = build();
    const out = await orchestrator.renderPresentation({
      tenantId: 't1',
      templateSlug: 'monthly_revenue',
      themeSlug: 'modern_clean',
      params: {},
    });
    // First artifact is the title slide.
    const firstArtifact: DeckSlideArtifact | undefined = out.slideArtifacts[0];
    expect(firstArtifact?.slideKind).toBe('title');
    expect(firstArtifact?.title).toBe('Monthly Revenue Report');
    // At least one bullet slide for narrative / table.
    const bulletSlides = out.slideArtifacts.filter(
      (a) => a.slideKind === 'bullet',
    );
    expect(bulletSlides.length).toBeGreaterThanOrEqual(1);
  });

  it('emits Piece-G-compatible DeckSlideArtifact shape', async () => {
    const orchestrator = build();
    const out = await orchestrator.renderPresentation({
      tenantId: 't1',
      templateSlug: 'q3_strategy',
      themeSlug: 'classic_corporate',
      params: {},
    });
    for (const a of out.slideArtifacts) {
      expect(a.componentType).toBe('deck_slide');
      expect(typeof a.slideIndex).toBe('number');
      expect(typeof a.slideKind).toBe('string');
      expect(typeof a.themeSlug).toBe('string');
    }
  });

  it('snapshots produce bytewise-different outputs across themes (visual diff lite)', async () => {
    const orchestrator = build();
    const a = await orchestrator.renderPresentation({
      tenantId: 't1',
      templateSlug: 'q3_strategy',
      themeSlug: 'minimal_dark',
      params: {},
    });
    const b = await orchestrator.renderPresentation({
      tenantId: 't1',
      templateSlug: 'q3_strategy',
      themeSlug: 'africa_warm',
      params: {},
    });
    // Themes differ → outputs must differ (even if the slide content is identical).
    expect(a.buffer.equals(b.buffer)).toBe(false);
  });
});
