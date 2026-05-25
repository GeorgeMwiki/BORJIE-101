/**
 * `kra.draft_filing` — DRAFT-only.
 *
 * Produces an eRITS-shaped payload for the owner to review. Does NOT
 * submit. The MD's policy gate routes this draft to the HQ-tier
 * `platform.file_kra_mri` four-eye queue when the owner approves.
 */

import type { CompiledMriBatch } from './compile-mri-batch.js';
import type { ValidationResult } from './validate-pre-filing.js';

export interface ErritsLine {
  readonly tenantPin: string | null;
  readonly tenantName: string;
  readonly propertyAddress: string;
  readonly grossRentMinor: number;
  readonly withholdingMinor: number;
  readonly currency: string;
}

export interface DraftErritsPayload {
  readonly schemaVersion: 'kra-erits-v1';
  readonly ownerPin: string;
  readonly period: { readonly year: number; readonly month: number };
  readonly lines: ReadonlyArray<ErritsLine>;
  readonly totals: {
    readonly grossRentMinor: number;
    readonly withholdingMinor: number;
    readonly lineCount: number;
  };
  readonly currency: string;
  readonly draftStatus: 'queued-for-owner-review' | 'blocked-validation-failed';
  readonly nextStepGuidance: string;
  readonly validationSummary: {
    readonly ok: boolean;
    readonly errorCount: number;
    readonly warnCount: number;
  };
}

export interface DraftFilingArgs {
  readonly batch: CompiledMriBatch;
  readonly validation: ValidationResult;
}

export function draftFiling(args: DraftFilingArgs): DraftErritsPayload {
  const { batch, validation } = args;
  const lines: ErritsLine[] = batch.lines.map(l => ({
    tenantPin: l.tenantKraPin ?? null,
    tenantName: l.tenantName,
    propertyAddress: l.propertyAddress,
    grossRentMinor: l.grossRentMinor,
    withholdingMinor: l.withholdingMinor,
    currency: l.currency,
  }));
  const currency = batch.lines[0]?.currency ?? 'KES';
  const draftStatus: DraftErritsPayload['draftStatus'] = validation.ok
    ? 'queued-for-owner-review'
    : 'blocked-validation-failed';
  const nextStepGuidance = validation.ok
    ? 'Owner reviews the eRITS payload and approves → MD routes to platform.file_kra_mri (HQ-tier, four-eye).'
    : `Fix ${validation.errorCount} validation errors before this draft can leave the queue.`;
  return Object.freeze({
    schemaVersion: 'kra-erits-v1',
    ownerPin: batch.ownerKraPin,
    period: batch.period,
    lines: Object.freeze(lines),
    totals: Object.freeze({
      grossRentMinor: batch.totals.grossRentMinor,
      withholdingMinor: batch.totals.withholdingMinor,
      lineCount: batch.totals.lineCount,
    }),
    currency,
    draftStatus,
    nextStepGuidance,
    validationSummary: Object.freeze({
      ok: validation.ok,
      errorCount: validation.errorCount,
      warnCount: validation.warnCount,
    }),
  });
}
