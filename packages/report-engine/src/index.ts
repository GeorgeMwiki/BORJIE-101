/**
 * @borjie/report-engine — Piece H.
 *
 * Renders templated reports (Q3 strategy, monthly revenue, etc.) into
 * PDF + DOCX + PPTX in tenant brand. Pulls live data through
 * repositories via the `ReportDataAdapter` contract — no LLM-generated
 * SQL ever.
 *
 * Quick start:
 *
 *   import {
 *     createReportOrchestrator,
 *     BUILT_IN_TEMPLATES,
 *     InMemoryReportTemplateStore,
 *     createDevDataAdapter,
 *   } from '@borjie/report-engine';
 *
 *   const orchestrator = createReportOrchestrator({
 *     templateStore: new InMemoryReportTemplateStore(),
 *     dataAdapter: createDevDataAdapter(),
 *     brandResolver: { resolve: async () => ({ displayName: 'Acme' }) },
 *   });
 *
 *   const result = await orchestrator.renderReport({
 *     tenantId: 'tenant-1',
 *     templateSlug: 'q3_strategy',
 *     outputFormats: ['pdf', 'docx', 'pptx'],
 *     params: { period: 'Q3 2026' },
 *   });
 */

export type {
  ReportFormat,
  ReportSectionKind,
  ReportTemplateSection,
  ReportTemplate,
  ReportTableData,
  ReportKpiGridData,
  ReportChartData,
  ResolvedReportSection,
  TenantBrand,
  RenderedReportFile,
  ReportDataAdapter,
  TenantBrandResolver,
  ReportTemplateStore,
  RenderReportInput,
  RenderReportOutput,
} from './types.js';

export { ReportEngineError } from './types.js';

export type { PresentationSlideMasterSpec } from './presentation-types.js';

export {
  ReportOrchestrator,
  createReportOrchestrator,
  type ReportOrchestratorDeps,
  type RendererOverrides,
} from './orchestrator.js';

export {
  InMemoryReportDataAdapter,
  createDevDataAdapter,
  type DataSourceHandler,
} from './data-source.js';

export {
  BUILT_IN_TEMPLATES,
  InMemoryReportTemplateStore,
} from './templates/built-in.js';

export {
  renderReportPdf,
  type RenderPdfInput,
  sanitizeFilename,
} from './renderers/pdf.js';

export { renderReportDocx, type RenderDocxInput } from './renderers/docx.js';

export { renderReportPptx, type RenderPptxInput } from './renderers/pptx.js';

export { writeZip, escapeXml, type ZipEntry } from './ooxml-zip.js';
