/**
 * End-to-end smoke test for createDocumentQualityGuarantor. Wires up
 * the in-memory implementations of every subsystem and proves a
 * round-trip from request → engine → audit replay works without
 * touching any real external service.
 */
import { describe, expect, it } from 'vitest';
import {
  createDocumentQualityGuarantor,
  createEscalationService,
  createInMemoryAuditChainStore,
  createInMemoryRetryQueue,
  createIntakeOrchestrator,
  createOutputOrchestrator,
} from '../index.js';
import type {
  DocumentBytes,
  ExtractedDocument,
  IntakeEngine,
  IntakeHints,
  OutputEngine,
  RenderTemplate,
  RenderedDocument,
  SupportedFormat,
} from '../types.js';

function makeIntake(id: string, confidence: number): IntakeEngine {
  return {
    id,
    supportedLanguages: ['*'],
    async extract(doc: DocumentBytes, _h?: IntakeHints): Promise<ExtractedDocument> {
      const text = new TextDecoder().decode(doc.bytes);
      return {
        intakeId: 'unset',
        sourceSha256: 'sha',
        producedBy: id,
        pages: [{ pageNumber: 1, text, confidence }],
        confidence,
        language: 'en',
        text,
        producedAtIso: new Date().toISOString(),
      };
    },
  };
}

function makeOutput(id: string, formats: ReadonlyArray<SupportedFormat>): OutputEngine {
  return {
    id,
    supportedFormats: formats,
    async render(
      _t: RenderTemplate,
      data: Readonly<Record<string, unknown>>,
      format: SupportedFormat,
    ): Promise<RenderedDocument> {
      return {
        outputId: 'unset',
        bytes: new TextEncoder().encode(JSON.stringify(data)),
        mime: 'application/pdf',
        format,
        sha256: 'unset',
        producedBy: id,
        producedAtIso: new Date().toISOString(),
      };
    },
  };
}

describe('createDocumentQualityGuarantor', () => {
  it('processes intake + output + replays audit end-to-end', async () => {
    const audit = createInMemoryAuditChainStore();
    const intake = createIntakeOrchestrator({
      engines: [makeIntake('tesseract', 0.92)],
      audit,
    });
    const output = createOutputOrchestrator({
      engines: [makeOutput('typst', ['pdf'])],
      audit,
    });
    const queue = createInMemoryRetryQueue({ audit });
    const escalation = createEscalationService({ audit });
    const guarantor = createDocumentQualityGuarantor({
      intake,
      output,
      queue,
      escalation,
      audit,
    });

    const extracted = await guarantor.processIntake({
      doc: { bytes: new TextEncoder().encode('hello'), mime: 'image/png' },
      tenantId: 't-1',
    });
    expect(extracted.producedBy).toBe('tesseract');

    const rendered = await guarantor.processOutput({
      template: { id: 'tmpl', body: '{{name}}' },
      data: { name: 'world' },
      format: 'pdf',
      tenantId: 't-1',
    });
    expect(rendered.producedBy).toBe('typst');

    const intakeReplay = await guarantor.replayAudit('t-1', extracted.intakeId);
    expect(intakeReplay.attemptsByEngine.length).toBe(1);
    const outputReplay = await guarantor.replayAudit('t-1', rendered.outputId);
    expect(outputReplay.attemptsByEngine.length).toBe(1);
  });
});
