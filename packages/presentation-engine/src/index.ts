/**
 * @borjie/presentation-engine — Piece H.
 *
 * Renders presentations in tenant brand. Mounts on top of
 * `@borjie/report-engine`'s PPTX renderer with theme override
 * and emits Piece-G-compatible slide artifacts so the same data
 * flows into the conversational UI.
 *
 * Quick start:
 *
 *   import {
 *     createPresentationOrchestrator,
 *     InMemoryThemeStore,
 *     BUILT_IN_THEMES,
 *   } from '@borjie/presentation-engine';
 *   import {
 *     InMemoryReportTemplateStore,
 *     createDevDataAdapter,
 *   } from '@borjie/report-engine';
 *
 *   const orchestrator = createPresentationOrchestrator({
 *     templateStore: new InMemoryReportTemplateStore(),
 *     themeStore: new InMemoryThemeStore(),
 *     dataAdapter: createDevDataAdapter(),
 *     brandResolver: { resolve: async () => ({ displayName: 'Acme' }) },
 *   });
 *
 *   const { buffer, slideArtifacts } = await orchestrator.renderPresentation({
 *     tenantId: 't1',
 *     templateSlug: 'q3_strategy',
 *     themeSlug: 'africa_warm',
 *     params: { period: 'Q3 2026' },
 *   });
 */

export type {
  Slide,
  SlideKind,
  TitleSlide,
  BulletSlide,
  ChartSlide,
  ImageSlide,
  SectionDividerSlide,
  Deck,
  DeckSlideArtifact,
  RenderPresentationInput,
  RenderPresentationOutput,
} from './types.js';

export { PresentationEngineError } from './types.js';

export {
  PresentationOrchestrator,
  createPresentationOrchestrator,
  InMemoryThemeStore,
  type PresentationOrchestratorDeps,
  type ThemeStore,
} from './orchestrator.js';

export { SlideBuilder } from './slide-builder.js';

export {
  renderChartToPng,
  placeholderPng,
} from './chart-render.js';

export { BUILT_IN_THEMES, type PresentationTheme } from './themes/built-in.js';
