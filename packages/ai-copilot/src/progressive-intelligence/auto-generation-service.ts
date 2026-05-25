/**
 * Auto-Generation Service — "talk to the brain to migrate this CSV".
 *
 * Accumulator fills fields from an LPMS dump (via @borjie/lpms-connector),
 * renders a preview the operator confirms, then a commit function hands
 * off to the MigrationWriterService (not imported here to keep the package
 * decoupled; callers inject the writer).
 *
 * @module progressive-intelligence/auto-generation-service
 */

import type { ContextAccumulatorService } from './context-accumulator.js';
import { validateAccumulatedContext } from './validation/index.js';
import type { AccumulatedEstateContext } from './types.js';

export interface LpmsRow {
  readonly rowIndex: number;
  readonly data: Record<string, unknown>;
}

export interface GenerationPreview {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly rowCountTotal: number;
  readonly rowCountParsed: number;
  readonly rowCountFailed: number;
  readonly firstRowContext: AccumulatedEstateContext | null;
  readonly validation: ReturnType<typeof validateAccumulatedContext> | null;
  readonly unresolvedFields: readonly string[];
}

export interface MigrationWriter {
  commit(input: {
    tenantId: string;
    sessionId: string;
    rows: readonly AccumulatedEstateContext[];
  }): Promise<{ commitedRowCount: number; writerRef: string }>;
}

export interface AutoGenerationInput {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly sourceSystem: string;
  readonly sourceFile: string;
  readonly rows: readonly LpmsRow[];
}

export class AutoGenerationService {
  constructor(
    private readonly accumulator: ContextAccumulatorService,
    private readonly writer: MigrationWriter | null = null,
  ) {}

  async buildPreview(input: AutoGenerationInput): Promise<GenerationPreview> {
    assertTenant(input.tenantId);
    let firstContext: AccumulatedEstateContext | null = null;
    let parsed = 0;
    let failed = 0;
    const unresolved = new Set<string>();

    for (const row of input.rows) {
      try {
        // Use a per-row session id to accumulate independently
        const perRowSession = `${input.sessionId}::row-${row.rowIndex}`;
        const ctx = this.accumulator.ingestLpmsRow({
          sessionId: perRowSession,
          tenantId: input.tenantId,
          sourceSystem: input.sourceSystem,
          sourceFile: input.sourceFile,
          row: row.data,
        });
        if (!firstContext) firstContext = ctx;
        const report = validateAccumulatedContext(ctx);
        if (!report.valid) {
          for (const err of report.errors) {
            unresolved.add(`${err.section}.${err.field}`);
          }
        }
        parsed += 1;
      } catch {
        failed += 1;
      }
    }

    // Record aggregated migration batch metadata on the parent session
    this.accumulator.ingestLpmsRow({
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      sourceSystem: input.sourceSystem,
      sourceFile: input.sourceFile,
      row: {},
    });

    const aggCtx = this.accumulator.getContext(input.sessionId, input.tenantId);
    const validation = aggCtx ? validateAccumulatedContext(aggCtx) : null;

    return {
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      rowCountTotal: input.rows.length,
      rowCountParsed: parsed,
      rowCountFailed: failed,
      firstRowContext: firstContext,
      validation,
      unresolvedFields: Array.from(unresolved),
    };
  }

  async commit(input: {
    tenantId: string;
    sessionId: string;
    rows: readonly AccumulatedEstateContext[];
  }): Promise<{ commitedRowCount: number; writerRef: string }> {
    assertTenant(input.tenantId);
    if (!this.writer) {
      throw new Error(
        'auto-generation-service: no MigrationWriter configured; commit blocked',
      );
    }
    // Hard safety — every row must match the caller tenant
    for (const row of input.rows) {
      if (row.tenantId !== input.tenantId) {
        throw new Error(
          'auto-generation-service: cross-tenant row detected; commit aborted',
        );
      }
    }
    return this.writer.commit(input);
  }
}

function assertTenant(tenantId: string): void {
  if (!tenantId || tenantId.trim().length === 0) {
    throw new Error('auto-generation-service: tenantId is required');
  }
}

export function createAutoGenerationService(
  accumulator: ContextAccumulatorService,
  writer?: MigrationWriter,
): AutoGenerationService {
  return new AutoGenerationService(accumulator, writer ?? null);
}
