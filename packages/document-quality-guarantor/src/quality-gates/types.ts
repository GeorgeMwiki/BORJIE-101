/**
 * Quality-gate input shapes — one per gate. Keeping them separate
 * means each gate is fully typed; composition is wrapper-light.
 */

import type {
  ExtractedDocument,
  QualityGate,
  RenderedDocument,
  RoundtripCheck,
} from '../types.js';

export interface ConfidenceGateInput {
  readonly extracted: ExtractedDocument;
}

export interface SchemaCompletenessGateInput {
  readonly extracted: ExtractedDocument;
  /**
   * Map of required-field-path → field-value pairs the caller has
   * pre-extracted from `extracted`. Gate verifies every required
   * path is present + non-empty.
   */
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface CitationCoverageGateInput {
  readonly answer: string;
  readonly citations: ReadonlyArray<{
    readonly quote: string;
    readonly source: string;
  }>;
  /** Quantitative tokens the gate considers (digits, $, %, dates). */
  readonly quantitativeClaims?: ReadonlyArray<string>;
}

export interface RoundtripFidelityGateInput {
  readonly source: { readonly text: string };
  /**
   * Caller provides the rendered output AND the OCR result of that
   * rendered output. Gate only computes similarity + verdict.
   */
  readonly rendered: RenderedDocument;
  readonly extractedFromRendered: ExtractedDocument;
}

export interface VisualDiffGateInput {
  /**
   * Two equal-length pixel buffers (RGBA, height * width * 4). The
   * gate compares them with a tolerance and rejects if pixel-diff %
   * exceeds the configured budget.
   */
  readonly baseline: Uint8Array;
  readonly candidate: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface FontEmbeddingGateInput {
  /** Raw PDF bytes — gate scans for `FontFile`/`FontFile2`/`FontFile3`. */
  readonly pdfBytes: Uint8Array;
}

export interface AccessibilityGateInput {
  /** Raw PDF bytes — gate looks for /MarkInfo + /StructTreeRoot. */
  readonly pdfBytes: Uint8Array;
}

/** Re-export the public gate interface for module ergonomics. */
export type Gate<T> = QualityGate<T>;
export type RoundtripCheckOut = RoundtripCheck;
