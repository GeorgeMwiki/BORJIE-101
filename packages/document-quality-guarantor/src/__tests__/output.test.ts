/**
 * Output orchestrator tests:
 *  - PDF format routes to Typst first when engineHint is set
 *  - PDF format falls over to Puppeteer when Typst throws
 *  - throws when no engine supports the format
 *  - per-engine timeout aborts a long-running render
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryAuditChainStore, replayOperation } from '../audit/index.js';
import { createOutputOrchestrator } from '../output/index.js';
import type { OutputEngine, RenderedDocument, RenderTemplate, SupportedFormat } from '../types.js';

function makeEngine(
  id: string,
  opts: {
    formats: ReadonlyArray<SupportedFormat>;
    throws?: boolean;
    delayMs?: number;
    bytesText?: string;
  },
): OutputEngine {
  return {
    id,
    supportedFormats: opts.formats,
    async render(
      _template: RenderTemplate,
      _data: Readonly<Record<string, unknown>>,
      format: SupportedFormat,
    ): Promise<RenderedDocument> {
      if (opts.delayMs !== undefined) {
        await new Promise((r) => setTimeout(r, opts.delayMs));
      }
      if (opts.throws) throw new Error(`${id}_threw`);
      const bytes = new TextEncoder().encode(opts.bytesText ?? `out:${id}`);
      return {
        outputId: 'unset',
        bytes,
        mime: 'application/pdf',
        format,
        sha256: 'placeholder',
        producedBy: id,
        producedAtIso: new Date().toISOString(),
      };
    },
  };
}

const TEMPLATE: RenderTemplate = {
  id: 'tmpl-1',
  body: 'hello {{name}}',
};

describe('OutputOrchestrator', () => {
  let audit = createInMemoryAuditChainStore();
  beforeEach(() => {
    audit = createInMemoryAuditChainStore();
  });

  it('routes PDF to Typst first when engineHint is set', async () => {
    const orch = createOutputOrchestrator({
      engines: [
        makeEngine('puppeteer', { formats: ['pdf'] }),
        makeEngine('typst', { formats: ['pdf'] }),
      ],
      audit,
    });
    const out = await orch.render({
      template: { ...TEMPLATE, engineHint: 'typst' },
      data: { name: 'world' },
      format: 'pdf',
      tenantId: 'tenant-1',
    });
    expect(out.producedBy).toBe('typst');
  });

  it('falls over to puppeteer when Typst throws', async () => {
    const orch = createOutputOrchestrator({
      engines: [
        makeEngine('typst', { formats: ['pdf'], throws: true }),
        makeEngine('puppeteer', { formats: ['pdf'] }),
      ],
      audit,
    });
    const out = await orch.render({
      template: TEMPLATE,
      data: {},
      format: 'pdf',
      tenantId: 'tenant-1',
    });
    expect(out.producedBy).toBe('puppeteer');
  });

  it('throws when no engine supports the requested format', async () => {
    const onAllFailed = vi.fn(async () => undefined);
    const orch = createOutputOrchestrator({
      engines: [makeEngine('puppeteer', { formats: ['pdf'] })],
      audit,
      onAllFailed,
    });
    await expect(
      orch.render({
        template: TEMPLATE,
        data: {},
        format: 'xlsx',
        tenantId: 'tenant-1',
      }),
    ).rejects.toThrow(/no engine supports/);
    expect(onAllFailed).toHaveBeenCalledOnce();
  });

  it('per-engine timeout aborts a long-running render', async () => {
    const orch = createOutputOrchestrator({
      engines: [makeEngine('typst', { formats: ['pdf'], delayMs: 200 })],
      audit,
    });
    await expect(
      orch.render({
        template: TEMPLATE,
        data: {},
        format: 'pdf',
        tenantId: 'tenant-1',
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/all engines failed/);
  });

  it('overwrites sha256 with a recomputed hash for provenance', async () => {
    const orch = createOutputOrchestrator({
      engines: [makeEngine('typst', { formats: ['pdf'], bytesText: 'stable-payload' })],
      audit,
    });
    const out = await orch.render({
      template: TEMPLATE,
      data: {},
      format: 'pdf',
      tenantId: 'tenant-1',
    });
    expect(out.sha256).not.toBe('placeholder');
    expect(out.sha256).toMatch(/^[a-f0-9]{16,64}$/);
  });

  it('audit replay records the attempt sequence', async () => {
    const orch = createOutputOrchestrator({
      engines: [
        makeEngine('typst', { formats: ['pdf'], throws: true }),
        makeEngine('puppeteer', { formats: ['pdf'] }),
      ],
      audit,
    });
    const out = await orch.render({
      template: TEMPLATE,
      data: {},
      format: 'pdf',
      tenantId: 'tenant-1',
    });
    const replay = await replayOperation(audit, 'tenant-1', out.outputId);
    expect(replay.attemptsByEngine.length).toBe(2);
    expect(replay.attemptsByEngine.find((a) => a.engineId === 'puppeteer')!.succeeded).toBe(true);
  });
});
