/**
 * Quality-gate tests. One describe block per gate; the composed-gate
 * test at the bottom exercises bail-on-first-failure + score
 * aggregation.
 */

import { describe, expect, it } from 'vitest';
import {
  accessibilityGate,
  citationCoverageGate,
  composeGates,
  confidenceGate,
  fontEmbeddingGate,
  roundtripFidelityGate,
  schemaCompletenessGate,
  visualDiffGate,
} from '../quality-gates/index.js';
import type { ExtractedDocument, RenderedDocument } from '../types.js';

function makeExtracted(confidence: number, text = 'hello world'): ExtractedDocument {
  return {
    intakeId: 'i-1',
    sourceSha256: 'sha-1',
    producedBy: 'tesseract',
    pages: [{ pageNumber: 1, text, confidence }],
    confidence,
    language: 'en',
    text,
    producedAtIso: new Date().toISOString(),
  };
}

function makeRendered(bytes: Uint8Array, format: 'pdf' = 'pdf'): RenderedDocument {
  return {
    outputId: 'o-1',
    bytes,
    mime: 'application/pdf',
    format,
    sha256: 'sha-1',
    producedBy: 'typst',
    producedAtIso: new Date().toISOString(),
  };
}

describe('confidenceGate', () => {
  it('passes when confidence >= threshold', async () => {
    const gate = confidenceGate({ minConfidence: 0.85 });
    const report = await gate.evaluate({ extracted: makeExtracted(0.9) });
    expect(report.score.passed).toBe(true);
  });

  it('blocks when confidence < threshold', async () => {
    const gate = confidenceGate({ minConfidence: 0.85 });
    const report = await gate.evaluate({ extracted: makeExtracted(0.7) });
    expect(report.score.passed).toBe(false);
    expect(report.reasons[0]).toMatch(/below threshold/);
  });
});

describe('schemaCompletenessGate', () => {
  it('passes when all required fields present', async () => {
    const gate = schemaCompletenessGate({ requiredFields: ['name', 'amount'] });
    const report = await gate.evaluate({
      extracted: makeExtracted(0.99),
      fields: { name: 'Tenant A', amount: 1500 },
    });
    expect(report.score.passed).toBe(true);
  });

  it('blocks on missing field with per-field reason', async () => {
    const gate = schemaCompletenessGate({ requiredFields: ['name', 'amount'] });
    const report = await gate.evaluate({
      extracted: makeExtracted(0.99),
      fields: { name: '   ', amount: 1500 },
    });
    expect(report.score.passed).toBe(false);
    expect(report.reasons.some((r) => r.includes('name'))).toBe(true);
  });

  it('partial score reflects fraction present', async () => {
    const gate = schemaCompletenessGate({
      requiredFields: ['a', 'b', 'c', 'd'],
    });
    const report = await gate.evaluate({
      extracted: makeExtracted(1),
      fields: { a: 1, b: 2 },
    });
    expect(report.score.value).toBe(0.5);
  });
});

describe('citationCoverageGate', () => {
  it('passes when every quantitative claim has citation', async () => {
    const gate = citationCoverageGate({ minCoverage: 1 });
    const report = await gate.evaluate({
      answer: 'Revenue was $1500 in 2024.',
      citations: [
        { quote: 'Q4 revenue: $1500 total', source: 'doc-1' },
        { quote: 'reporting period 2024', source: 'doc-1' },
      ],
    });
    expect(report.score.passed).toBe(true);
  });

  it('blocks on an uncited number', async () => {
    const gate = citationCoverageGate({ minCoverage: 1 });
    const report = await gate.evaluate({
      answer: 'Revenue was $1500 in 2024.',
      citations: [{ quote: 'reporting period 2024', source: 'doc-1' }],
    });
    expect(report.score.passed).toBe(false);
    expect(report.reasons.some((r) => r.includes('$1500'))).toBe(true);
  });

  it('passes when no quantitative claims present', async () => {
    const gate = citationCoverageGate({ minCoverage: 2 });
    const report = await gate.evaluate({
      answer: 'The tenant is responsible for utilities.',
      citations: [],
    });
    expect(report.score.passed).toBe(true);
  });
});

describe('roundtripFidelityGate', () => {
  it('passes on identical text', async () => {
    const gate = roundtripFidelityGate({ similarityThreshold: 0.95 });
    const report = await gate.evaluate({
      source: { text: 'The quick brown fox jumps over the lazy dog' },
      rendered: makeRendered(new Uint8Array()),
      extractedFromRendered: makeExtracted(1, 'The quick brown fox jumps over the lazy dog'),
    });
    expect(report.score.passed).toBe(true);
    expect(report.score.value).toBe(1);
  });

  it('blocks when roundtrip drift exceeds threshold', async () => {
    const gate = roundtripFidelityGate({ similarityThreshold: 0.95 });
    const report = await gate.evaluate({
      source: { text: 'Tenant balance is fifteen hundred dollars' },
      rendered: makeRendered(new Uint8Array()),
      extractedFromRendered: makeExtracted(1, 'completely different garbled output'),
    });
    expect(report.score.passed).toBe(false);
    expect(report.reasons[0]).toMatch(/drift detected/);
  });
});

describe('visualDiffGate', () => {
  const W = 4;
  const H = 4;
  const SIZE = W * H * 4;

  it('passes on identical buffers', async () => {
    const gate = visualDiffGate({ pixelTolerance: 0.005 });
    const buf = new Uint8Array(SIZE).fill(255);
    const report = await gate.evaluate({
      baseline: buf,
      candidate: new Uint8Array(buf),
      width: W,
      height: H,
    });
    expect(report.score.passed).toBe(true);
  });

  it('passes within color tolerance (anti-aliasing noise)', async () => {
    const gate = visualDiffGate({ pixelTolerance: 0.005, colorTolerance: 5 });
    const buf = new Uint8Array(SIZE).fill(200);
    const noisy = new Uint8Array(SIZE).fill(202); // delta=2 < tolerance
    const report = await gate.evaluate({
      baseline: buf,
      candidate: noisy,
      width: W,
      height: H,
    });
    expect(report.score.passed).toBe(true);
  });

  it('blocks when too many pixels differ', async () => {
    const gate = visualDiffGate({ pixelTolerance: 0.01, colorTolerance: 5 });
    const buf = new Uint8Array(SIZE).fill(0);
    const flipped = new Uint8Array(SIZE).fill(255);
    const report = await gate.evaluate({
      baseline: buf,
      candidate: flipped,
      width: W,
      height: H,
    });
    expect(report.score.passed).toBe(false);
  });

  it('blocks on dimension mismatch', async () => {
    const gate = visualDiffGate({ pixelTolerance: 0.01 });
    const report = await gate.evaluate({
      baseline: new Uint8Array(SIZE),
      candidate: new Uint8Array(SIZE + 4),
      width: W,
      height: H,
    });
    expect(report.score.passed).toBe(false);
    expect(report.reasons[0]).toMatch(/dimension mismatch/);
  });
});

describe('fontEmbeddingGate', () => {
  it('passes when no fonts referenced (image-only PDF)', async () => {
    const gate = fontEmbeddingGate();
    const minimalPdf = new TextEncoder().encode('%PDF-1.7\n%EOF\n');
    const report = await gate.evaluate({ pdfBytes: minimalPdf });
    expect(report.score.passed).toBe(true);
  });

  it('blocks when FontDescriptor present without FontFile', async () => {
    const gate = fontEmbeddingGate();
    const pdf = new TextEncoder().encode(
      '%PDF-1.7\n1 0 obj << /FontDescriptor 2 0 R >> endobj\n%EOF',
    );
    const report = await gate.evaluate({ pdfBytes: pdf });
    expect(report.score.passed).toBe(false);
    expect(report.reasons[0]).toMatch(/unembedded fonts/);
  });

  it('passes when FontFile2 entry matches FontDescriptor', async () => {
    const gate = fontEmbeddingGate();
    const pdf = new TextEncoder().encode(
      '%PDF-1.7\n1 0 obj << /FontDescriptor 2 0 R /FontFile2 3 0 R >> endobj\n%EOF',
    );
    const report = await gate.evaluate({ pdfBytes: pdf });
    expect(report.score.passed).toBe(true);
  });

  it('blocks non-PDF input', async () => {
    const gate = fontEmbeddingGate();
    const report = await gate.evaluate({
      pdfBytes: new TextEncoder().encode('not a pdf'),
    });
    expect(report.score.passed).toBe(false);
  });

  it('flags encrypted PDF for review', async () => {
    const gate = fontEmbeddingGate();
    const pdf = new TextEncoder().encode(
      '%PDF-1.7\ntrailer << /Encrypt 5 0 R >>\n%EOF',
    );
    const report = await gate.evaluate({ pdfBytes: pdf });
    expect(report.score.passed).toBe(false);
    expect(report.reasons[0]).toMatch(/encrypted/);
  });
});

describe('accessibilityGate', () => {
  it('passes when both MarkInfo and StructTreeRoot present', async () => {
    const gate = accessibilityGate();
    const pdf = new TextEncoder().encode(
      '%PDF-1.7\n1 0 obj << /MarkInfo << /Marked true >> /StructTreeRoot 2 0 R >> endobj\n%EOF',
    );
    const report = await gate.evaluate({ pdfBytes: pdf });
    expect(report.score.passed).toBe(true);
  });

  it('blocks when /MarkInfo missing', async () => {
    const gate = accessibilityGate();
    const pdf = new TextEncoder().encode(
      '%PDF-1.7\n1 0 obj << /StructTreeRoot 2 0 R >> endobj\n%EOF',
    );
    const report = await gate.evaluate({ pdfBytes: pdf });
    expect(report.score.passed).toBe(false);
  });

  it('blocks when both missing', async () => {
    const gate = accessibilityGate();
    const pdf = new TextEncoder().encode('%PDF-1.7\n%EOF');
    const report = await gate.evaluate({ pdfBytes: pdf });
    expect(report.score.passed).toBe(false);
    expect(report.reasons.length).toBe(2);
  });
});

describe('composeGates', () => {
  it('passes when all sub-gates pass', async () => {
    const composed = composeGates([
      confidenceGate({ minConfidence: 0.8 }),
      schemaCompletenessGate({ requiredFields: ['name'] }),
    ]);
    const report = await composed.evaluate({
      inputs: {
        confidenceGate: { extracted: makeExtracted(0.9) },
        schemaCompletenessGate: { extracted: makeExtracted(0.9), fields: { name: 'A' } },
      },
    });
    expect(report.score.passed).toBe(true);
  });

  it('blocks if any sub-gate blocks and collects reasons', async () => {
    const composed = composeGates([
      confidenceGate({ minConfidence: 0.8 }),
      schemaCompletenessGate({ requiredFields: ['name', 'amount'] }),
    ]);
    const report = await composed.evaluate({
      inputs: {
        confidenceGate: { extracted: makeExtracted(0.9) },
        schemaCompletenessGate: { extracted: makeExtracted(0.9), fields: { name: 'A' } },
      },
    });
    expect(report.score.passed).toBe(false);
    expect(report.reasons.some((r) => r.includes('[schemaCompletenessGate]'))).toBe(true);
  });

  it('bailOnFirstFailure stops after first block', async () => {
    let secondCalled = false;
    const tracerGate = {
      id: 'tracer',
      async evaluate(): Promise<import('../types.js').QualityReport> {
        secondCalled = true;
        return {
          gateId: 'tracer',
          score: { value: 1, threshold: 1, passed: true },
          reasons: ['ok'],
        };
      },
    };
    const composed = composeGates(
      [confidenceGate({ minConfidence: 0.95 }), tracerGate],
      { bailOnFirstFailure: true },
    );
    const report = await composed.evaluate({
      inputs: {
        confidenceGate: { extracted: makeExtracted(0.5) },
        tracer: {},
      },
    });
    expect(report.score.passed).toBe(false);
    expect(secondCalled).toBe(false);
  });

  it('skips sub-gate when no input provided', async () => {
    const composed = composeGates([
      confidenceGate({ minConfidence: 0.8 }),
      schemaCompletenessGate({ requiredFields: ['name'] }),
    ]);
    const report = await composed.evaluate({
      inputs: {
        // Only provide confidenceGate input
        confidenceGate: { extracted: makeExtracted(0.9) },
      },
    });
    expect(report.score.passed).toBe(true);
  });
});
