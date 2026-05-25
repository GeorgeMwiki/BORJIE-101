/**
 * Intake orchestrator tests:
 *  - primary engine succeeds → return first result
 *  - primary fails (low confidence) → next engine called → succeeds
 *  - all fail → escalation fires, orchestrator throws
 *  - cache hit short-circuits engine calls
 *  - language hint reorders engine priority
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryAuditChainStore, replayOperation } from '../audit/index.js';
import { createIntakeOrchestrator } from '../intake/index.js';
import type {
  DocumentBytes,
  ExtractedDocument,
  IntakeEngine,
  IntakeHints,
} from '../types.js';

function makeEngine(
  id: string,
  opts: {
    confidence: number;
    languages?: ReadonlyArray<string>;
    throws?: boolean;
  },
): IntakeEngine {
  return {
    id,
    supportedLanguages: opts.languages ?? ['*'],
    async extract(doc: DocumentBytes, _hints?: IntakeHints): Promise<ExtractedDocument> {
      if (opts.throws) throw new Error(`${id}_threw`);
      return {
        intakeId: 'unset', // overwritten by orchestrator
        sourceSha256: 'sha-stub',
        producedBy: id,
        pages: [{ pageNumber: 1, text: `extracted by ${id}`, confidence: opts.confidence }],
        confidence: opts.confidence,
        language: 'en',
        text: `extracted by ${id}`,
        producedAtIso: new Date().toISOString(),
      };
    },
  };
}

const bytesFor = (text: string): DocumentBytes => ({
  bytes: new TextEncoder().encode(text),
  mime: 'image/png',
});

describe('IntakeOrchestrator', () => {
  let audit = createInMemoryAuditChainStore();
  beforeEach(() => {
    audit = createInMemoryAuditChainStore();
  });

  it('returns the first engine that meets the confidence threshold', async () => {
    const orch = createIntakeOrchestrator({
      engines: [
        makeEngine('tesseract', { confidence: 0.95 }),
        makeEngine('paddleocr', { confidence: 0.99 }),
      ],
      audit,
    });
    const result = await orch.extract({
      doc: bytesFor('hello'),
      tenantId: 'tenant-1',
    });
    expect(result.producedBy).toBe('tesseract');
    expect(result.confidence).toBe(0.95);
  });

  it('falls over when primary confidence is below threshold', async () => {
    const orch = createIntakeOrchestrator({
      engines: [
        makeEngine('tesseract', { confidence: 0.4 }),
        makeEngine('paddleocr', { confidence: 0.93 }),
      ],
      audit,
    });
    const result = await orch.extract({
      doc: bytesFor('hello'),
      tenantId: 'tenant-1',
    });
    expect(result.producedBy).toBe('paddleocr');
  });

  it('treats a thrown engine as a failure and tries the next one', async () => {
    const orch = createIntakeOrchestrator({
      engines: [
        makeEngine('tesseract', { confidence: 0.99, throws: true }),
        makeEngine('paddleocr', { confidence: 0.91 }),
      ],
      audit,
    });
    const result = await orch.extract({
      doc: bytesFor('hello'),
      tenantId: 'tenant-1',
    });
    expect(result.producedBy).toBe('paddleocr');
  });

  it('fires the escalation hook when all engines fail and throws', async () => {
    const onAllFailed = vi.fn(async () => undefined);
    const orch = createIntakeOrchestrator({
      engines: [
        makeEngine('tesseract', { confidence: 0.3 }),
        makeEngine('paddleocr', { confidence: 0.2 }),
      ],
      audit,
      onAllFailed,
    });
    await expect(
      orch.extract({ doc: bytesFor('hello'), tenantId: 'tenant-1' }),
    ).rejects.toThrow(/all engines failed/);
    expect(onAllFailed).toHaveBeenCalledOnce();
  });

  it('cache hit short-circuits engine calls', async () => {
    const engine = makeEngine('tesseract', { confidence: 0.95 });
    const spy = vi.spyOn(engine, 'extract');
    const orch = createIntakeOrchestrator({
      engines: [engine],
      audit,
    });
    const doc = bytesFor('hello');
    const first = await orch.extract({ doc, tenantId: 'tenant-1' });
    const second = await orch.extract({ doc, tenantId: 'tenant-1' });
    expect(spy).toHaveBeenCalledOnce();
    expect(orch.cacheSize()).toBe(1);
    expect(first.text).toBe(second.text);
  });

  it('language hint floats language-matching engines to the front', async () => {
    const orch = createIntakeOrchestrator({
      engines: [
        makeEngine('tesseract', { confidence: 0.95, languages: ['en'] }),
        makeEngine('paddleocr-sw', { confidence: 0.97, languages: ['sw'] }),
      ],
      audit,
    });
    const result = await orch.extract({
      doc: bytesFor('habari'),
      hints: { lang: ['sw'] },
      tenantId: 'tenant-1',
    });
    expect(result.producedBy).toBe('paddleocr-sw');
  });

  it('audit replay records every attempt in order', async () => {
    const orch = createIntakeOrchestrator({
      engines: [
        makeEngine('tesseract', { confidence: 0.3 }),
        makeEngine('paddleocr', { confidence: 0.95 }),
      ],
      audit,
    });
    const result = await orch.extract({
      doc: bytesFor('payload'),
      tenantId: 'tenant-1',
    });
    const replay = await replayOperation(audit, 'tenant-1', result.intakeId);
    expect(replay.attemptsByEngine.length).toBe(2);
    expect(replay.attemptsByEngine.find((a) => a.engineId === 'paddleocr')!.succeeded).toBe(true);
  });
});
