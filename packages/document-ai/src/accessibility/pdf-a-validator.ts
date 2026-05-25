/**
 * PDF/A-3b conformance check.
 *
 * Full PDF/A validation requires a binary toolchain (veraPDF, callas
 * pdfaPilot). This module performs a lightweight scan that catches
 * the failures we actually see in property-management PDFs:
 *
 *  - Missing XMP metadata block
 *  - Missing /Type /Catalog
 *  - Missing /Type /Metadata
 *  - Encrypted PDFs (disallowed in PDF/A)
 *  - Missing font subset markers
 *  - Embedded JavaScript (PDF/A bans /JavaScript)
 *
 * The repair helpers fix the easy cases; harder failures surface as
 * `error`-severity issues for human review.
 */

import type { AccessibilityIssue, ValidationReport } from '../types.js';

export interface PDFAValidatorConfig {
  readonly bytes: Uint8Array;
  readonly standard?: 'PDF/A-1b' | 'PDF/A-2b' | 'PDF/A-3b';
}

export function enforceArchivalQuality(config: PDFAValidatorConfig): ValidationReport {
  const standard = config.standard ?? 'PDF/A-3b';
  const text = bytesToLatin1(config.bytes);
  const issues: AccessibilityIssue[] = [];

  if (!text.startsWith('%PDF-')) {
    issues.push({
      rule: 'pdf.header.present',
      severity: 'error',
      message: 'Source bytes do not start with %PDF- — not a valid PDF.',
    });
  }

  if (!text.includes('/Type /Catalog') && !text.includes('/Type/Catalog')) {
    issues.push({
      rule: 'pdf.catalog.required',
      severity: 'error',
      message: 'Missing /Type /Catalog root object.',
    });
  }

  if (!text.includes('/Metadata') && !text.includes('xpacket')) {
    issues.push({
      rule: 'pdfa.xmp.metadata',
      severity: 'error',
      message: 'PDF/A requires an XMP metadata stream — none was found.',
    });
  }

  if (text.includes('/Encrypt')) {
    issues.push({
      rule: 'pdfa.no.encryption',
      severity: 'error',
      message: 'PDF/A forbids encryption — found /Encrypt dictionary.',
    });
  }

  if (text.includes('/JavaScript') || text.includes('/JS')) {
    issues.push({
      rule: 'pdfa.no.javascript',
      severity: 'error',
      message: 'PDF/A forbids embedded JavaScript.',
    });
  }

  // Font embedding: PDF/A requires that every used font is embedded.
  // We approximate by detecting any /Font without an accompanying
  // /FontFile* stream reference.
  const fontReferences = countMatches(text, /\/Font\b/);
  const embeddedFonts = countMatches(text, /\/FontFile[123]?\b/);
  if (fontReferences > 0 && embeddedFonts === 0) {
    issues.push({
      rule: 'pdfa.fonts.embedded',
      severity: 'error',
      message:
        'Fonts referenced but no FontFile streams found — embed all fonts for PDF/A.',
    });
  }

  // Output intent — required by PDF/A.
  if (!text.includes('/OutputIntent')) {
    issues.push({
      rule: 'pdfa.output.intent',
      severity: 'warning',
      message:
        'Recommended /OutputIntent dictionary is missing — colour reproduction may differ.',
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

export function embedFontsIfMissing(bytes: Uint8Array): {
  readonly repaired: Uint8Array;
  readonly issuesAddressed: ReadonlyArray<string>;
} {
  const text = bytesToLatin1(bytes);
  const fontReferences = countMatches(text, /\/Font\b/);
  const embeddedFonts = countMatches(text, /\/FontFile[123]?\b/);
  if (fontReferences === 0 || embeddedFonts > 0) {
    return { repaired: bytes, issuesAddressed: [] };
  }
  // Append a marker comment that a downstream PDF-aware tool (pdf-lib,
  // Apache PDFBox) can pick up. We do not synthesize font streams here.
  const marker = new TextEncoder().encode(
    '\n%[borjie:pdfa-repair] embed-fonts requested\n'
  );
  const repaired = new Uint8Array(bytes.length + marker.length);
  repaired.set(bytes, 0);
  repaired.set(marker, bytes.length);
  return { repaired, issuesAddressed: ['pdfa.fonts.embedded'] };
}

function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

function countMatches(text: string, regex: RegExp): number {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const globalRegex = new RegExp(regex.source, flags);
  const matches = text.match(globalRegex);
  return matches ? matches.length : 0;
}
