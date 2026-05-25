/**
 * PDF/UA-1 conformance check.
 *
 * Like the PDF/A validator this is intentionally lightweight. It scans
 * the raw PDF bytes for the structure-tree markers PDF/UA requires:
 *
 *  - MarkInfo with Marked true
 *  - StructTreeRoot present
 *  - Lang attribute at the catalog level
 *  - Alt text on figures (heuristic: every /Figure has /Alt)
 *  - Title in the Document Info dictionary or XMP metadata
 *
 * A real conformance pass needs PAC 2024 (PDF Accessibility Checker)
 * or veraPDF — this module is the fast pre-flight that catches the
 * obvious failures before we hand off to a paid tool.
 */

import type { AccessibilityIssue, ValidationReport } from '../types.js';

export interface PDFUAValidatorConfig {
  readonly bytes: Uint8Array;
  readonly standard?: 'PDF/UA-1' | 'PDF/UA-2';
}

export function enforceAccessibility(config: PDFUAValidatorConfig): ValidationReport {
  const standard = config.standard ?? 'PDF/UA-1';
  const text = bytesToLatin1(config.bytes);
  const issues: AccessibilityIssue[] = [];

  if (!text.includes('/MarkInfo') || !text.includes('/Marked true')) {
    issues.push({
      rule: 'pdfua.marked.true',
      severity: 'error',
      message: 'PDF/UA requires /MarkInfo with Marked true.',
    });
  }

  if (!text.includes('/StructTreeRoot')) {
    issues.push({
      rule: 'pdfua.struct.tree',
      severity: 'error',
      message: 'PDF/UA requires a /StructTreeRoot for the structure tree.',
    });
  }

  if (!/\/Lang\s*\(/.test(text)) {
    issues.push({
      rule: 'pdfua.lang.attribute',
      severity: 'error',
      message: 'PDF/UA requires a /Lang attribute at the catalog level.',
    });
  }

  // Every /Figure structural element must have /Alt text.
  const figureCount = countMatches(text, /\/Figure\b/);
  const altCount = countMatches(text, /\/Alt\s*\(/);
  if (figureCount > altCount) {
    issues.push({
      rule: 'pdfua.figure.alt',
      severity: 'error',
      message: `Found ${figureCount} /Figure elements but only ${altCount} /Alt entries.`,
    });
  }

  if (!text.includes('/Title')) {
    issues.push({
      rule: 'pdfua.title.required',
      severity: 'warning',
      message: 'Recommended /Title metadata is missing.',
    });
  }

  const errors = issues.filter((i) => i.severity === 'error');
  return {
    standard,
    conformant: errors.length === 0,
    issues,
    checkedAt: new Date(),
  };
}

export function addAccessibilityTags(bytes: Uint8Array): {
  readonly repaired: Uint8Array;
  readonly issuesAddressed: ReadonlyArray<string>;
} {
  const text = bytesToLatin1(bytes);
  const addressed: string[] = [];
  // We can't reliably mutate the binary structure here; we add a hint
  // comment for downstream PDF tooling.
  let hint = '\n%[borjie:pdfua-repair]';
  if (!text.includes('/MarkInfo')) {
    hint += ' add-mark-info';
    addressed.push('pdfua.marked.true');
  }
  if (!text.includes('/StructTreeRoot')) {
    hint += ' add-struct-tree';
    addressed.push('pdfua.struct.tree');
  }
  if (!/\/Lang\s*\(/.test(text)) {
    hint += ' add-lang';
    addressed.push('pdfua.lang.attribute');
  }
  if (addressed.length === 0) {
    return { repaired: bytes, issuesAddressed: [] };
  }
  hint += '\n';
  const encoded = new TextEncoder().encode(hint);
  const repaired = new Uint8Array(bytes.length + encoded.length);
  repaired.set(bytes, 0);
  repaired.set(encoded, bytes.length);
  return { repaired, issuesAddressed: addressed };
}

function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]!);
  return out;
}

function countMatches(text: string, regex: RegExp): number {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const globalRegex = new RegExp(regex.source, flags);
  const matches = text.match(globalRegex);
  return matches ? matches.length : 0;
}
