/**
 * KE_DPA Export Formatter
 *
 * Kenya Data Protection Act (2019) — audit schema for data-processing
 * activities involving PII. Output is JSON-Lines so regulators can stream
 * and each record is independently parseable.
 *
 * Fields mirror the KE Office of the Data Protection Commissioner (ODPC)
 * register of processing activities (ROPA) plus a DPIA hash for each
 * aggregated record.
 */

export type KeDpaProcessingBasis =
  | 'consent'
  | 'contract'
  | 'legal_obligation'
  | 'vital_interests'
  | 'public_task'
  | 'legitimate_interests';

export interface KeDpaAuditEntry {
  readonly recordId: string;
  readonly dataSubjectId: string;
  readonly dataSubjectCategory: 'tenant' | 'landlord' | 'staff' | 'vendor';
  readonly dataCategories: readonly string[];
  readonly purpose: string;
  readonly processingBasis: KeDpaProcessingBasis;
  readonly consentGiven: boolean;
  readonly consentGivenAt: string | null;
  readonly retentionPeriodDays: number;
  readonly crossBorderTransfers: readonly string[];
  readonly processorName: string;
  readonly actionTimestamp: string;
  readonly dpiaReference: string | null;
}

export interface KeDpaExportContext {
  readonly controllerName: string;
  readonly controllerRegistrationNumber: string;
  readonly dpoContactEmail: string;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface KeDpaExportRecord extends KeDpaAuditEntry {
  readonly controllerName: string;
  readonly controllerRegistrationNumber: string;
  readonly dpoContactEmail: string;
  readonly exportedAt: string;
}

export function buildKeDpaRecord(
  entry: KeDpaAuditEntry,
  context: KeDpaExportContext,
): KeDpaExportRecord {
  return {
    ...entry,
    controllerName: context.controllerName,
    controllerRegistrationNumber: context.controllerRegistrationNumber,
    dpoContactEmail: context.dpoContactEmail,
    exportedAt: new Date().toISOString(),
  };
}

export function formatKeDpaJsonLines(
  entries: readonly KeDpaAuditEntry[],
  context: KeDpaExportContext,
): string {
  return entries
    .map((e) => JSON.stringify(buildKeDpaRecord(e, context)))
    .join('\n');
}

export const KE_DPA_FORMATTER = {
  id: 'ke_dpa' as const,
  format: formatKeDpaJsonLines,
  buildRecord: buildKeDpaRecord,
};
