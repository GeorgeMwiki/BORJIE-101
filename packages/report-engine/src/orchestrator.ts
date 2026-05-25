/**
 * Report orchestrator — entry point for `renderReport({tenantId,
 * templateSlug, outputFormats, params})`.
 *
 * Flow:
 *   1. Resolve template by slug (tenant override → platform built-in)
 *   2. Reject unsupported output formats
 *   3. Resolve tenant brand
 *   4. For each section, call the data-source adapter
 *   5. Hand the resolved sections + brand to each format renderer
 *   6. Return the bundle of files
 *
 * Renderers are injected (`pdf`, `docx`, `pptx`) so composition roots
 * can swap to Playwright-based PDF or pptxgenjs-based PPTX later
 * without disturbing the orchestrator.
 */

import { renderReportPdf } from './renderers/pdf.js';
import { renderReportDocx } from './renderers/docx.js';
import { renderReportPptx } from './renderers/pptx.js';
import type {
  RenderReportInput,
  RenderReportOutput,
  ReportTemplate,
  ReportTemplateStore,
  ReportDataAdapter,
  ReportFormat,
  ResolvedReportSection,
  RenderedReportFile,
  TenantBrand,
  TenantBrandResolver,
} from './types.js';
import { ReportEngineError } from './types.js';

export interface RendererOverrides {
  readonly pdf?: (input: {
    readonly title: string;
    readonly subtitle?: string;
    readonly sections: readonly ResolvedReportSection[];
    readonly brand: TenantBrand;
    readonly generatedAt: Date;
  }) => Promise<RenderedReportFile> | RenderedReportFile;
  readonly docx?: (input: {
    readonly title: string;
    readonly subtitle?: string;
    readonly sections: readonly ResolvedReportSection[];
    readonly brand: TenantBrand;
    readonly generatedAt: Date;
  }) => Promise<RenderedReportFile> | RenderedReportFile;
  readonly pptx?: (input: {
    readonly title: string;
    readonly subtitle?: string;
    readonly sections: readonly ResolvedReportSection[];
    readonly brand: TenantBrand;
    readonly generatedAt: Date;
  }) => Promise<RenderedReportFile> | RenderedReportFile;
}

export interface ReportOrchestratorDeps {
  readonly templateStore: ReportTemplateStore;
  readonly dataAdapter: ReportDataAdapter;
  readonly brandResolver: TenantBrandResolver;
  readonly renderers?: RendererOverrides;
  readonly clock?: () => Date;
}

export class ReportOrchestrator {
  private readonly deps: ReportOrchestratorDeps;

  constructor(deps: ReportOrchestratorDeps) {
    this.deps = deps;
  }

  async renderReport(input: RenderReportInput): Promise<RenderReportOutput> {
    const template = await this.deps.templateStore.findBySlug({
      tenantId: input.tenantId,
      slug: input.templateSlug,
    });
    if (!template) {
      throw new ReportEngineError(
        `Template not found: ${input.templateSlug}`,
        'TEMPLATE_NOT_FOUND',
      );
    }

    this.assertFormatsSupported(template, input.outputFormats);

    const brand = await this.deps.brandResolver.resolve(input.tenantId);

    const resolvedSections: ResolvedReportSection[] = [];
    for (const section of template.sections) {
      try {
        const resolved = await this.deps.dataAdapter.resolve({
          tenantId: input.tenantId,
          dataSource: section.data_source,
          params: input.params,
        });
        resolvedSections.push({
          ...resolved,
          section_id: section.section_id,
          title: section.title,
          kind: section.kind,
        });
      } catch (err) {
        throw new ReportEngineError(
          `Data-source failure for section "${section.section_id}" (${section.data_source})`,
          'DATA_SOURCE_FAILURE',
          err,
        );
      }
    }

    const clock = this.deps.clock ?? (() => new Date());
    const generatedAt = clock();

    const subtitle =
      brand.displayName + ' • ' + this.formatPeriodSubtitle(input.params);

    const files = await Promise.all(
      input.outputFormats.map(async (format) =>
        this.renderOne(
          format,
          template,
          resolvedSections,
          brand,
          subtitle,
          generatedAt,
        ),
      ),
    );

    return {
      templateSlug: template.slug,
      tenantId: input.tenantId,
      files,
      renderedAt: generatedAt,
    };
  }

  private assertFormatsSupported(
    template: ReportTemplate,
    requested: readonly ReportFormat[],
  ): void {
    const allowed = new Set(template.outputFormats);
    for (const fmt of requested) {
      if (!allowed.has(fmt)) {
        throw new ReportEngineError(
          `Template "${template.slug}" does not support format ${fmt}. Allowed: ${[...allowed].join(', ')}`,
          'UNSUPPORTED_FORMAT',
        );
      }
    }
  }

  private async renderOne(
    format: ReportFormat,
    template: ReportTemplate,
    sections: readonly ResolvedReportSection[],
    brand: TenantBrand,
    subtitle: string,
    generatedAt: Date,
  ): Promise<RenderedReportFile> {
    const renderInput = {
      title: template.displayNameEn,
      subtitle,
      sections,
      brand,
      generatedAt,
    };
    try {
      if (format === 'pdf') {
        const pdf = this.deps.renderers?.pdf;
        return pdf ? await pdf(renderInput) : renderReportPdf(renderInput);
      }
      if (format === 'docx') {
        const docx = this.deps.renderers?.docx;
        return docx ? await docx(renderInput) : renderReportDocx(renderInput);
      }
      const pptx = this.deps.renderers?.pptx;
      return pptx ? await pptx(renderInput) : renderReportPptx(renderInput);
    } catch (err) {
      if (err instanceof ReportEngineError) throw err;
      throw new ReportEngineError(
        `Renderer failure (${format}) for template "${template.slug}"`,
        'RENDERER_FAILURE',
        err,
      );
    }
  }

  private formatPeriodSubtitle(params: Readonly<Record<string, unknown>>): string {
    const period = params['period'];
    if (typeof period === 'string') return period;
    const periodLabel = params['period_label'];
    if (typeof periodLabel === 'string') return periodLabel;
    return new Date().toISOString().slice(0, 10);
  }
}

/** Convenience factory for the orchestrator. */
export function createReportOrchestrator(
  deps: ReportOrchestratorDeps,
): ReportOrchestrator {
  return new ReportOrchestrator(deps);
}
