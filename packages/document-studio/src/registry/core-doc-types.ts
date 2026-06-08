/**
 * @borjie/document-studio — core (hand-verified) doc-type specs.
 *
 * Binds the existing builders' view transforms into `DocTypeSpec`s and
 * registers them. This is the CLOSED SET — the fast, audited path. The
 * open-ended long tail is registered at runtime via `registry.register`.
 *
 * Each spec reuses the already-shipped data-schema + view transform, so
 * there is no duplicate render logic — the registry just adapts them to
 * the uniform `(schema, binder, engineHint, defaultFormats)` contract.
 */

import type { DocTypeRegistry, DocTypeSpec } from './doc-type.js';
import {
  LicenceApplicationDataSchema,
  type LicenceApplicationData,
} from '../templates/licence-application/data-schema.js';
import {
  toLicenceApplicationView,
  LICENCE_APPLICATION_TEMPLATE_REF,
} from '../templates/licence-application/builder.js';
import {
  RoyaltyStatementDataSchema,
  type RoyaltyStatementData,
} from '../templates/royalty-statement/data-schema.js';
import {
  toRoyaltyStatementView,
  ROYALTY_STATEMENT_TEMPLATE_REF,
} from '../templates/royalty-statement/builder.js';
import {
  MonthlyOwnerReportDataSchema,
  type MonthlyOwnerReportData,
} from '../templates/monthly-owner-report/data-schema.js';
import { MONTHLY_OWNER_REPORT_TEMPLATE_REF } from '../templates/monthly-owner-report/builder.js';
import { offtakeSettlementDocType } from '../templates/offtake-settlement/builder.js';

/** Licence application — Typst PDF, regulator-grade. */
export const licenceApplicationDocType: DocTypeSpec<
  LicenceApplicationData,
  ReturnType<typeof toLicenceApplicationView>
> = {
  id: 'licence_application',
  title: 'Mining Licence Application',
  schema: LicenceApplicationDataSchema,
  binder: (data) => ({
    templateRef: LICENCE_APPLICATION_TEMPLATE_REF,
    view: toLicenceApplicationView(data),
    locale: data.locale,
    currencyCode: data.currencyCode,
  }),
  engineHint: 'typst',
  defaultFormats: ['pdf'],
  // Data-bound form: fee figures live in fields, covered by claim-match.
  citationMode: 'structured',
};

/** Royalty statement — Typst PDF (Carbone XLSX is a separate spec). */
export const royaltyStatementDocType: DocTypeSpec<
  RoyaltyStatementData,
  ReturnType<typeof toRoyaltyStatementView>
> = {
  id: 'royalty_statement',
  title: 'Mineral Royalty Statement',
  schema: RoyaltyStatementDataSchema,
  binder: (data) => ({
    templateRef: ROYALTY_STATEMENT_TEMPLATE_REF,
    view: toRoyaltyStatementView(data),
    locale: data.locale,
    currencyCode: data.currencyCode,
  }),
  engineHint: 'typst',
  defaultFormats: ['pdf'],
  // Per-shipment royalty TABLE: figures in cells, covered by claim-match.
  citationMode: 'structured',
};

/**
 * Monthly owner report — Carbone Office template → DOCX + PDF. The
 * Carbone path addresses `{d.*}` paths so the bound view is the raw
 * validated data plus the owner currency threaded for the archive.
 */
export const monthlyOwnerReportDocType: DocTypeSpec<
  MonthlyOwnerReportData,
  MonthlyOwnerReportData
> = {
  id: 'monthly_owner_report',
  title: 'Monthly Owner Report',
  schema: MonthlyOwnerReportDataSchema,
  binder: (data) => ({
    templateRef: MONTHLY_OWNER_REPORT_TEMPLATE_REF,
    view: data,
    // The monthly report is owner-facing; locale defaults to en. (The
    // Carbone template is brand-locked and single-language by design.)
    locale: 'en',
    currencyCode: data.owner.currencyPref,
  }),
  engineHint: 'carbone',
  defaultFormats: ['docx', 'pdf'],
};

export const CORE_DOC_TYPES: ReadonlyArray<DocTypeSpec> = [
  licenceApplicationDocType as unknown as DocTypeSpec,
  royaltyStatementDocType as unknown as DocTypeSpec,
  monthlyOwnerReportDocType as unknown as DocTypeSpec,
  offtakeSettlementDocType as unknown as DocTypeSpec,
];

/** Seed a registry with the core hand-verified set. */
export function registerCoreDocTypes(registry: DocTypeRegistry): void {
  for (const spec of CORE_DOC_TYPES) {
    registry.register(spec, { overwrite: true });
  }
}
