/**
 * `kra.validate_pre_filing` — read tier.
 *
 * Schema + KRA-PIN format + amount-sanity check on a compiled MRI
 * batch. Returns structured issues; never throws.
 *
 * KRA PIN format: AnnnnnnnnnA (1 letter, 9 digits, 1 letter) — kept
 * lenient (10 alphanumerics minimum) because the canonical regex is
 * jurisdiction-managed by the MCP process-intel server.
 */

import type { CompiledMriBatch } from './compile-mri-batch.js';

export interface ValidationIssue {
  readonly severity: 'error' | 'warn';
  readonly code:
    | 'missing-owner-pin'
    | 'malformed-owner-pin'
    | 'malformed-tenant-pin'
    | 'missing-tenant-pin'
    | 'negative-amount'
    | 'withholding-exceeds-gross'
    | 'zero-gross-line'
    | 'currency-mismatch'
    | 'empty-batch';
  readonly lineIndex?: number;
  readonly message: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly errorCount: number;
  readonly warnCount: number;
  readonly issues: ReadonlyArray<ValidationIssue>;
}

const KRA_PIN_RX = /^[A-Z]\d{9}[A-Z]$/;

export function validatePreFiling(batch: CompiledMriBatch): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!batch.ownerKraPin) {
    issues.push({ severity: 'error', code: 'missing-owner-pin', message: 'owner KRA PIN is required' });
  } else if (!KRA_PIN_RX.test(batch.ownerKraPin)) {
    issues.push({ severity: 'error', code: 'malformed-owner-pin', message: `owner KRA PIN '${batch.ownerKraPin}' does not match AnnnnnnnnnA format` });
  }

  if (batch.lines.length === 0) {
    issues.push({ severity: 'error', code: 'empty-batch', message: 'no rental-income lines in this batch' });
  }

  // Currency consistency
  if (batch.lines.length > 1) {
    const firstLine = batch.lines[0]!;
    const ccy = firstLine.currency;
    batch.lines.forEach((l, i) => {
      if (l.currency !== ccy) {
        issues.push({
          severity: 'error',
          code: 'currency-mismatch',
          lineIndex: i,
          message: `line currency ${l.currency} mismatches batch currency ${ccy}`,
        });
      }
    });
  }

  // Per-line checks
  batch.lines.forEach((l, i) => {
    if (l.grossRentMinor < 0) {
      issues.push({ severity: 'error', code: 'negative-amount', lineIndex: i, message: 'gross rent is negative' });
    }
    if (l.withholdingMinor < 0) {
      issues.push({ severity: 'error', code: 'negative-amount', lineIndex: i, message: 'withholding is negative' });
    }
    if (l.grossRentMinor === 0) {
      issues.push({ severity: 'warn', code: 'zero-gross-line', lineIndex: i, message: 'zero gross rent on line' });
    }
    if (l.withholdingMinor > l.grossRentMinor) {
      issues.push({ severity: 'error', code: 'withholding-exceeds-gross', lineIndex: i, message: 'withholding > gross rent' });
    }
    if (l.tenantKraPin && !KRA_PIN_RX.test(l.tenantKraPin)) {
      issues.push({ severity: 'warn', code: 'malformed-tenant-pin', lineIndex: i, message: `tenant PIN '${l.tenantKraPin}' malformed` });
    }
    if (!l.tenantKraPin) {
      issues.push({ severity: 'warn', code: 'missing-tenant-pin', lineIndex: i, message: 'tenant PIN missing' });
    }
  });

  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warnCount = issues.filter(i => i.severity === 'warn').length;

  return Object.freeze({
    ok: errorCount === 0,
    errorCount,
    warnCount,
    issues: Object.freeze(issues),
  });
}
