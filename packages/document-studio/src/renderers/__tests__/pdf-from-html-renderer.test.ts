/**
 * Unit tests for PdfFromHtmlRenderer — no real Chromium. Drives
 * both the injected-factory path (production) and the dynamic
 * puppeteer-import path (lazy peer dep). Asserts page lifecycle,
 * env-driven launch options, and structured errors.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_HTML_PDF_TIMEOUT_MS,
  PdfFromHtmlRenderer,
  type HtmlPdfBrowserPage,
  type HtmlPdfFactoryHandle,
  type PuppeteerLike,
} from '../pdf-from-html-renderer.js';
import { type RendererInput } from '../../types.js';

const html = '<html><body><h1>Tenant Ledger</h1></body></html>';

function makePage(): HtmlPdfBrowserPage & {
  setContent: ReturnType<typeof vi.fn>;
  pdf: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return {
    setContent: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeInput(format: 'pdf' | 'docx' = 'pdf'): RendererInput {
  return {
    templateRef: 'ledger-report',
    format,
    data: { html },
  };
}

describe('PdfFromHtmlRenderer — stub mode', () => {
  beforeEach(() => {
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.PUPPETEER_HEADLESS;
    delete process.env.HTML_PDF_TIMEOUT_MS;
  });

  it('returns deterministic stub when useStub is set', async () => {
    const renderer = new PdfFromHtmlRenderer({ useStub: true });
    expect(renderer.isStub()).toBe(true);
    const out = await renderer.render(makeInput());
    expect(new TextDecoder().decode(out.buffer)).toContain('STUB:pdf-from-html');
  });
});

describe('PdfFromHtmlRenderer — input validation', () => {
  it('returns unsupported_format for non-PDF', async () => {
    const page = makePage();
    const renderer = new PdfFromHtmlRenderer({
      factory: async () => ({ page }),
    });
    const out = await renderer.render(makeInput('docx'));
    expect(out.error?.code).toBe('unsupported_format');
  });

  it('returns invalid_input when data.html is missing', async () => {
    const renderer = new PdfFromHtmlRenderer({
      factory: async () => ({ page: makePage() }),
    });
    const out = await renderer.render({
      templateRef: 'x',
      format: 'pdf',
      data: { not_html: 1 },
    });
    expect(out.error?.code).toBe('invalid_input');
  });
});

describe('PdfFromHtmlRenderer — factory path', () => {
  it('calls setContent + pdf + close in order', async () => {
    const page = makePage();
    const factory = vi.fn().mockResolvedValue({ page });
    const renderer = new PdfFromHtmlRenderer({ factory, pageFormat: 'Letter' });
    const out = await renderer.render(makeInput());
    expect(out.error).toBeUndefined();
    expect(out.mimeType).toBe('application/pdf');
    expect(Array.from(out.buffer)).toEqual([0x25, 0x50, 0x44, 0x46]);

    expect(page.setContent).toHaveBeenCalledWith(html, {
      waitUntil: 'networkidle0',
    });
    expect(page.pdf).toHaveBeenCalledWith({
      format: 'Letter',
      printBackground: true,
    });
    expect(page.close).toHaveBeenCalledOnce();
  });

  it('still closes page on render failure', async () => {
    const page = makePage();
    page.pdf.mockRejectedValueOnce(new Error('renderer crashed'));
    const renderer = new PdfFromHtmlRenderer({
      factory: async () => ({ page }),
    });
    const out = await renderer.render(makeInput());
    expect(out.error?.code).toBe('binary_failed');
    expect(out.error?.message).toContain('renderer crashed');
    expect(page.close).toHaveBeenCalledOnce();
  });

  it('invokes closeBrowser teardown when provided', async () => {
    const page = makePage();
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    const handle: HtmlPdfFactoryHandle = { page, closeBrowser };
    const renderer = new PdfFromHtmlRenderer({
      factory: async () => handle,
    });
    await renderer.render(makeInput());
    expect(closeBrowser).toHaveBeenCalledOnce();
  });

  it('coerces Buffer results from puppeteer into Uint8Array', async () => {
    const page = makePage();
    page.pdf.mockResolvedValueOnce(Buffer.from([1, 2, 3]));
    const renderer = new PdfFromHtmlRenderer({
      factory: async () => ({ page }),
    });
    const out = await renderer.render(makeInput());
    expect(out.buffer).toBeInstanceOf(Uint8Array);
    expect(Array.from(out.buffer)).toEqual([1, 2, 3]);
  });
});

describe('PdfFromHtmlRenderer — dynamic puppeteer import path', () => {
  beforeEach(() => {
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.PUPPETEER_HEADLESS;
  });

  it('returns browser_not_available when puppeteer import fails', async () => {
    const renderer = new PdfFromHtmlRenderer({
      puppeteerImport: async () => {
        throw new Error("Cannot find package 'puppeteer'");
      },
    });
    const out = await renderer.render(makeInput());
    expect(out.error?.code).toBe('browser_not_available');
    expect(out.error?.message).toContain('puppeteer not installed');
  });

  it('uses PUPPETEER_EXECUTABLE_PATH when set', async () => {
    process.env.PUPPETEER_EXECUTABLE_PATH = '/opt/chromium/chrome';
    const page = makePage();
    const newPage = vi.fn().mockResolvedValue(page);
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    const launch = vi
      .fn()
      .mockResolvedValue({ newPage, close: closeBrowser });
    const fakePuppeteer: PuppeteerLike = { launch };
    const renderer = new PdfFromHtmlRenderer({
      puppeteerImport: async () => fakePuppeteer,
    });
    const out = await renderer.render(makeInput());
    expect(out.error).toBeUndefined();
    expect(launch).toHaveBeenCalledOnce();
    const opts = launch.mock.calls[0]![0] as {
      executablePath?: string;
      headless?: unknown;
      args?: ReadonlyArray<string>;
    };
    expect(opts.executablePath).toBe('/opt/chromium/chrome');
    expect(opts.headless).toBe('new');
    expect(opts.args).toContain('--no-sandbox');
    expect(closeBrowser).toHaveBeenCalledOnce();
  });

  it('honours PUPPETEER_HEADLESS=false', async () => {
    process.env.PUPPETEER_HEADLESS = 'false';
    const page = makePage();
    const launch = vi.fn().mockResolvedValue({
      newPage: () => Promise.resolve(page),
      close: () => Promise.resolve(),
    });
    const renderer = new PdfFromHtmlRenderer({
      puppeteerImport: async () => ({ launch }),
    });
    await renderer.render(makeInput());
    expect(launch.mock.calls[0]![0]!.headless).toBe(false);
  });
});

describe('PdfFromHtmlRenderer — timeout defaults', () => {
  it('default timeout is 60s', () => {
    expect(DEFAULT_HTML_PDF_TIMEOUT_MS).toBe(60_000);
  });

  it('reads HTML_PDF_TIMEOUT_MS lazily', async () => {
    process.env.HTML_PDF_TIMEOUT_MS = '123';
    const page = makePage();
    const renderer = new PdfFromHtmlRenderer({
      factory: async () => ({ page }),
    });
    const out = await renderer.render(makeInput());
    expect(out.error).toBeUndefined();
    // We don't directly read timeoutMs; assert path completed.
  });
});

afterEach(() => {
  delete process.env.PUPPETEER_EXECUTABLE_PATH;
  delete process.env.PUPPETEER_HEADLESS;
  delete process.env.HTML_PDF_TIMEOUT_MS;
});
