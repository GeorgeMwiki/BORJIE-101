/**
 * Public types for the Piece H report engine.
 *
 * Decoupled from the database schema so consumers can build templates
 * + render without depending on @borjie/database. Repositories
 * adapt their rows into these shapes.
 */

/** Supported output formats for a rendered report. */
export type ReportFormat = 'pdf' | 'docx' | 'pptx';

/** What kind of content a section emits. */
export type ReportSectionKind = 'narrative' | 'table' | 'chart' | 'kpi_grid';

/**
 * One section in a template — placeholder describing what to fetch and
 * how to render it.
 */
export interface ReportTemplateSection {
  readonly section_id: string;
  readonly title: string;
  /** Data-source key (e.g. "payments-ledger.revenue.month_summary"). */
  readonly data_source: string;
  readonly kind: ReportSectionKind;
}

/**
 * A template, identified by slug. `tenantId` is null for platform
 * built-ins; tenant-authored templates carry a tenant id.
 */
export interface ReportTemplate {
  readonly id: string;
  readonly tenantId: string | null;
  readonly slug: string;
  readonly displayNameEn: string;
  readonly displayNameSw: string | null;
  readonly sections: readonly ReportTemplateSection[];
  readonly outputFormats: readonly ReportFormat[];
  readonly isBuiltIn: boolean;
}

/** Tabular data for a single section. */
export interface ReportTableData {
  readonly headers: readonly string[];
  readonly rows: ReadonlyArray<readonly (string | number)[]>;
}

/** KPI grid for a section. */
export interface ReportKpiGridData {
  readonly metrics: ReadonlyArray<{
    readonly label: string;
    readonly value: string | number;
    readonly delta?: string;
  }>;
}

/**
 * Vega-Lite-ish chart spec. We do not import vega-lite types here;
 * consumers can pass any spec that the chosen renderer understands.
 */
export interface ReportChartData {
  readonly title?: string;
  readonly spec: unknown;
  /** Pre-rendered PNG buffer if the orchestrator pre-rendered the chart. */
  readonly png?: Uint8Array;
}

/** Resolved data for a section, after the data-source has been called. */
export interface ResolvedReportSection {
  readonly section_id: string;
  readonly title: string;
  readonly kind: ReportSectionKind;
  readonly narrative?: string;
  readonly table?: ReportTableData;
  readonly chart?: ReportChartData;
  readonly kpi_grid?: ReportKpiGridData;
}

/**
 * Tenant brand overrides applied to the rendered output. The engine
 * uses defaults when fields are missing.
 */
export interface TenantBrand {
  readonly displayName: string;
  readonly logoPng?: Uint8Array;
  readonly primaryColor?: string;
  readonly secondaryColor?: string;
  readonly accentColor?: string;
  readonly fontFamily?: string;
}

/** Final rendered artifact returned from the orchestrator. */
export interface RenderedReportFile {
  readonly format: ReportFormat;
  readonly buffer: Buffer;
  readonly mimeType: string;
  readonly filename: string;
}

/**
 * Adapter contract: how the orchestrator fetches live tenant data for
 * a `data_source` key. Concrete adapters (payments-ledger, occupancy,
 * KPI engine) implement this interface so the engine itself stays
 * data-source-agnostic.
 */
export interface ReportDataAdapter {
  readonly resolve: (input: {
    readonly tenantId: string;
    readonly dataSource: string;
    readonly params: Readonly<Record<string, unknown>>;
  }) => Promise<ResolvedReportSection>;
}

/**
 * Tenant brand resolver — adapter contract. The repo will plug in a
 * real implementation that reads tenant settings; tests use a stub.
 */
export interface TenantBrandResolver {
  readonly resolve: (tenantId: string) => Promise<TenantBrand>;
}

/**
 * Template store contract. The repo plugs in a Drizzle-backed
 * implementation; tests use an in-memory store.
 */
export interface ReportTemplateStore {
  readonly findBySlug: (input: {
    readonly tenantId: string;
    readonly slug: string;
  }) => Promise<ReportTemplate | null>;
  readonly listForTenant: (
    tenantId: string,
  ) => Promise<ReadonlyArray<ReportTemplate>>;
}

/** Orchestrator entry-point input. */
export interface RenderReportInput {
  readonly tenantId: string;
  readonly templateSlug: string;
  readonly outputFormats: readonly ReportFormat[];
  /**
   * Free-form params forwarded to each section's data-source call.
   * E.g. {period: "previous_month"} for the monthly_revenue template.
   */
  readonly params: Readonly<Record<string, unknown>>;
}

/** Orchestrator output. */
export interface RenderReportOutput {
  readonly templateSlug: string;
  readonly tenantId: string;
  readonly files: readonly RenderedReportFile[];
  readonly renderedAt: Date;
}

/** Thrown when a render fails. */
export class ReportEngineError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'TEMPLATE_NOT_FOUND'
      | 'UNSUPPORTED_FORMAT'
      | 'DATA_SOURCE_FAILURE'
      | 'RENDERER_FAILURE',
    public override readonly cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'ReportEngineError';
  }
}
