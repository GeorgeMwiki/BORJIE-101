/**
 * HTML → PDF renderer (Puppeteer-backed).
 *
 * Used when the source artefact is already HTML — e.g. tenant ledger
 * dashboard exported from chat-ui, an ECharts SVG report wrapped in
 * brand HTML — and a print-fidelity PDF is the desired delivery
 * format. The research report names Playwright the 2026 winner vs
 * Puppeteer per npmtrends; both expose the same `page.pdf()` surface
 * so callers can swap in a Playwright `Page` via the `factory`
 * option.
 *
 * Behaviour:
 *
 *   - If a `factory` is supplied, use it. (Production: production
 *     code wires Playwright/Puppeteer here.)
 *   - Else, dynamically `import('puppeteer')` and use it. Read
 *     `PUPPETEER_EXECUTABLE_PATH` for the Chromium binary path so
 *     containerised deployments can mount a pre-installed browser.
 *   - Else, fall back to the deterministic stub renderer. This keeps
 *     tests passing in environments where puppeteer is not installed
 *     (it is an *optional* peer dep).
 *
 * Env (read LAZILY on first render):
 *
 *   PUPPETEER_EXECUTABLE_PATH    path to a Chromium/Chrome binary.
 *                                Optional; let puppeteer auto-resolve
 *                                when absent.
 *   PUPPETEER_HEADLESS           if set to `false`, run a headed
 *                                browser (debug only). Default: true.
 *   HTML_PDF_TIMEOUT_MS          per-render timeout. Default: 60000.
 *
 * Refs:
 *   - https://pptr.dev/api/puppeteer.page.pdf
 *   - https://pptr.dev/guides/headless-modes
 *   - https://playwright.dev/docs/api/class-page#page-pdf
 *   - .audit/litfin-sota-2026-05-23/19-document-generation.md §4
 */

import type {
  Renderer,
  RendererInput,
  RendererOutput,
} from '../types.js';
import { errorOutput, stubRender } from './carbone-renderer.js';

/** Default timeout for full render lifecycle (60s). */
export const DEFAULT_HTML_PDF_TIMEOUT_MS = 60_000;

/**
 * Minimal browser-page abstraction the renderer needs. Real impls
 * (Playwright `chromium.launch().newPage()` or puppeteer
 * `puppeteer.launch().newPage()`) already satisfy this shape.
 */
export interface HtmlPdfBrowserPage {
  setContent(html: string, options?: { waitUntil?: string }): Promise<void>;
  pdf(options: {
    format?: string;
    printBackground?: boolean;
  }): Promise<Uint8Array | Buffer>;
  close(): Promise<void>;
}

/** Factory returns a fresh page and a teardown for the browser. */
export interface HtmlPdfFactoryHandle {
  readonly page: HtmlPdfBrowserPage;
  /** Optional teardown — called after `page.close()` to shut the browser. */
  closeBrowser?: () => Promise<void>;
}

export type HtmlPdfPageFactory = () => Promise<HtmlPdfFactoryHandle>;

export interface PdfFromHtmlRendererOptions {
  /** Inject a factory — production wires Playwright or Puppeteer here. */
  readonly factory?: HtmlPdfPageFactory;
  /** Page size (Playwright/Puppeteer naming: 'A4', 'Letter'). Default 'A4'. */
  readonly pageFormat?: string;
  /** Per-render timeout. Overrides `HTML_PDF_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
  /**
   * Force stub even if puppeteer is importable — useful for tests
   * that want to assert behaviour without launching Chromium.
   */
  readonly useStub?: boolean;
  /**
   * Dynamic import seam — tests substitute a mock module here so
   * they can drive the default-puppeteer path without installing
   * the optional peer dep.
   */
  readonly puppeteerImport?: () => Promise<PuppeteerLike>;
}

/** Subset of `puppeteer` we use; matches puppeteer ≥ v21. */
export interface PuppeteerLike {
  launch(options?: {
    headless?: boolean | 'new' | 'shell';
    executablePath?: string;
    args?: ReadonlyArray<string>;
  }): Promise<PuppeteerBrowser>;
}

export interface PuppeteerBrowser {
  newPage(): Promise<HtmlPdfBrowserPage>;
  close(): Promise<void>;
}

export class PdfFromHtmlRenderer implements Renderer {
  public readonly id = 'pdf-from-html';
  private readonly options: PdfFromHtmlRendererOptions;

  constructor(options: PdfFromHtmlRendererOptions = {}) {
    this.options = options;
  }

  private resolveTimeout(): number {
    if (typeof this.options.timeoutMs === 'number') return this.options.timeoutMs;
    const envTimeout = Number(process.env.HTML_PDF_TIMEOUT_MS);
    if (Number.isFinite(envTimeout) && envTimeout > 0) return envTimeout;
    return DEFAULT_HTML_PDF_TIMEOUT_MS;
  }

  /**
   * True when stubbed by option. The dynamic-puppeteer path is only
   * known at render-time (we can't synchronously probe an optional
   * peer dep), so `isStub()` only reflects the *explicit* choice.
   */
  public isStub(): boolean {
    return this.options.useStub === true;
  }

  async render<TData>(input: RendererInput<TData>): Promise<RendererOutput> {
    if (this.isStub()) {
      return stubRender(this.id, input);
    }
    if (input.format !== 'pdf') {
      return errorOutput({
        code: 'unsupported_format',
        message: `PdfFromHtmlRenderer only emits PDF; requested format=${input.format}`,
        origin: this.id,
      });
    }

    const html = (input.data as { html?: unknown }).html;
    if (typeof html !== 'string') {
      return errorOutput({
        code: 'invalid_input',
        message: 'PdfFromHtmlRenderer requires `data.html: string`',
        origin: this.id,
      });
    }

    // Path 1 — explicit factory (production wiring).
    if (this.options.factory) {
      return this.renderWithFactory(this.options.factory, html);
    }

    // Path 2 — dynamic-import puppeteer (optional peer dep).
    return this.renderWithPuppeteer(html);
  }

  private async renderWithFactory(
    factory: HtmlPdfPageFactory,
    html: string,
  ): Promise<RendererOutput> {
    const timeoutMs = this.resolveTimeout();
    let handle: HtmlPdfFactoryHandle | undefined;
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    try {
      handle = await factory();
      await handle.page.setContent(html, { waitUntil: 'networkidle0' });
      const raw = await handle.page.pdf({
        format: this.options.pageFormat ?? 'A4',
        printBackground: true,
      });
      const buffer =
        raw instanceof Uint8Array ? raw : new Uint8Array(raw as Buffer);
      return { buffer, mimeType: 'application/pdf' };
    } catch (err) {
      const code = isAbortError(err) ? 'upstream_timeout' : 'binary_failed';
      return errorOutput({
        code,
        message: `PdfFromHtml render failed: ${(err as Error).message ?? String(err)}`,
        origin: this.id,
      });
    } finally {
      clearTimeout(timer);
      if (handle) {
        await handle.page.close().catch(() => undefined);
        if (handle.closeBrowser) {
          await handle.closeBrowser().catch(() => undefined);
        }
      }
    }
  }

  private async renderWithPuppeteer(html: string): Promise<RendererOutput> {
    const importer =
      this.options.puppeteerImport ??
      (() =>
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        // `puppeteer` is an optional peer dep. `Function('return import…')`
        // hides the bare-specifier import from the static-analyzed bundle
        // so this file still compiles in environments without puppeteer.
        (Function('return import("puppeteer")')() as Promise<PuppeteerLike>));

    let puppeteer: PuppeteerLike;
    try {
      puppeteer = await importer();
    } catch {
      // Optional peer dep not installed — fall back to deterministic
      // stub so callers in lean environments still get a buffer.
      return errorOutput({
        code: 'browser_not_available',
        message:
          'puppeteer not installed; install it (optional peer dep) or pass `factory`',
        origin: this.id,
      });
    }

    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    const headlessRaw = process.env.PUPPETEER_HEADLESS;
    const launchOpts: {
      headless: boolean | 'new' | 'shell';
      executablePath?: string;
      args: ReadonlyArray<string>;
    } = {
      headless: headlessRaw === 'false' ? false : 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };
    if (executablePath) {
      launchOpts.executablePath = executablePath;
    }

    const factory: HtmlPdfPageFactory = async () => {
      const browser = await puppeteer.launch(launchOpts);
      const page = await browser.newPage();
      return { page, closeBrowser: () => browser.close() };
    };
    return this.renderWithFactory(factory, html);
  }
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || (err as { code?: string }).code === 'ABORT_ERR')
  );
}
