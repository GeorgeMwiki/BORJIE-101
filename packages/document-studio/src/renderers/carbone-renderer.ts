/**
 * Carbone renderer — real implementation backed by a self-hosted
 * Carbone server.
 *
 * Carbone is the OSS template engine recommended by the research
 * report: one DOCX/ODT/HTML/XLSX template renders to any of
 * PDF/DOCX/XLSX/PPTX/ODS/HTML/CSV. We POST to
 * `${CARBONE_URL}/render/:templateId` with `{ data, convertTo }`,
 * receive a binary payload back, and surface upstream failures as
 * structured `RendererError` results instead of throwing.
 *
 * Env (read LAZILY on first render, not at module load — so tests
 * can override `process.env` between cases without re-importing):
 *
 *   CARBONE_URL          base URL of the Carbone server.
 *                        Default: `http://localhost:4000`.
 *   CARBONE_API_TOKEN    optional bearer token for hosted Carbone.
 *   CARBONE_TIMEOUT_MS   per-request timeout. Default: 60000.
 *
 * Stub mode kicks in when (a) no `carboneUrl` is supplied in options
 * AND (b) the renderer's `useStub` flag is set, so tests that don't
 * have a running Carbone container continue to pass.
 *
 * Refs:
 *   - https://carbone.io/api-reference.html (POST /render/:templateId)
 *   - https://carbone.io/documentation.html
 *   - .audit/litfin-sota-2026-05-23/19-document-generation.md §5
 */

import { createHash } from 'node:crypto';
import {
  MIME_TYPES,
  type DocFormat,
  type Renderer,
  type RendererError,
  type RendererInput,
  type RendererOutput,
} from '../types.js';

/** Default Carbone server URL when `CARBONE_URL` is unset. */
export const DEFAULT_CARBONE_URL = 'http://localhost:4000';
/** Default per-request timeout (60s — matches Carbone server hard cap). */
export const DEFAULT_CARBONE_TIMEOUT_MS = 60_000;

export interface CarboneRendererOptions {
  /**
   * Explicit Carbone URL. When set, overrides `CARBONE_URL`. Pass an
   * empty string to force stub mode regardless of env.
   */
  readonly carboneUrl?: string;
  /** Explicit bearer token. Overrides `CARBONE_API_TOKEN`. */
  readonly apiToken?: string;
  /** Per-request timeout. Overrides `CARBONE_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
  /**
   * Force stub mode even when env says otherwise — used by callers
   * that want to short-circuit the network without unsetting env.
   */
  readonly useStub?: boolean;
  /** Injection seam for tests — defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export class CarboneRenderer implements Renderer {
  public readonly id = 'carbone';
  private readonly options: CarboneRendererOptions;

  constructor(options: CarboneRendererOptions = {}) {
    this.options = options;
  }

  /**
   * Lazily resolve the effective Carbone URL — options win, then
   * `CARBONE_URL`, then the default. Returns `undefined` when the
   * caller explicitly passed an empty string (force-stub).
   */
  private resolveUrl(): string | undefined {
    if (this.options.carboneUrl === '') return undefined;
    if (this.options.carboneUrl) return this.options.carboneUrl;
    const envUrl = process.env.CARBONE_URL;
    if (envUrl === '') return undefined;
    return envUrl ?? DEFAULT_CARBONE_URL;
  }

  private resolveTimeout(): number {
    if (typeof this.options.timeoutMs === 'number') {
      return this.options.timeoutMs;
    }
    const envTimeout = Number(process.env.CARBONE_TIMEOUT_MS);
    if (Number.isFinite(envTimeout) && envTimeout > 0) return envTimeout;
    return DEFAULT_CARBONE_TIMEOUT_MS;
  }

  private resolveToken(): string | undefined {
    return this.options.apiToken ?? process.env.CARBONE_API_TOKEN;
  }

  /** True when the renderer will return a stub buffer (no network). */
  public isStub(): boolean {
    if (this.options.useStub) return true;
    return this.resolveUrl() === undefined;
  }

  async render<TData>(input: RendererInput<TData>): Promise<RendererOutput> {
    if (this.isStub()) {
      return stubRender(this.id, input);
    }
    return this.remoteRender(input);
  }

  private async remoteRender<TData>(
    input: RendererInput<TData>,
  ): Promise<RendererOutput> {
    const baseUrl = this.resolveUrl()!;
    const url = `${baseUrl}/render/${encodeURIComponent(input.templateRef)}`;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeoutMs = this.resolveTimeout();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: MIME_TYPES[input.format],
    };
    const token = this.resolveToken();
    if (token) headers['authorization'] = `Bearer ${token}`;

    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: input.data,
          convertTo: input.format,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return errorOutput({
          code: 'upstream_http_error',
          message: `Carbone returned ${response.status} ${response.statusText}`,
          status: response.status,
          origin: this.id,
        });
      }

      const buffer = new Uint8Array(await response.arrayBuffer());
      return {
        buffer,
        mimeType: MIME_TYPES[input.format],
      };
    } catch (err) {
      const code = isAbortError(err) ? 'upstream_timeout' : 'upstream_network_error';
      const message =
        code === 'upstream_timeout'
          ? `Carbone request aborted after ${timeoutMs}ms`
          : `Carbone request failed: ${(err as Error).message ?? String(err)}`;
      return errorOutput({ code, message, origin: this.id });
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Deterministic placeholder buffer. Encodes
 * `STUB:<rendererId>:<format>:<templateRef>:<hash>` so different
 * `(template, data, format)` combos hash distinctly while staying
 * byte-stable across runs. Exported so other stub renderers reuse
 * the contract.
 */
export function stubRender<TData>(
  rendererId: string,
  input: RendererInput<TData>,
): RendererOutput {
  const payload = JSON.stringify({
    template: input.templateRef,
    data: input.data,
  });
  const hash = createHash('sha256').update(payload).digest('hex').slice(0, 32);
  const text = `STUB:${rendererId}:${input.format}:${input.templateRef}:${hash}`;
  return {
    buffer: new TextEncoder().encode(text),
    mimeType: MIME_TYPES[input.format as DocFormat],
  };
}

/** Build a structured error output. Buffer is empty; mime stays JSON. */
export function errorOutput(error: RendererError): RendererOutput {
  return {
    buffer: new Uint8Array(0),
    mimeType: 'application/json',
    error,
  };
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || (err as { code?: string }).code === 'ABORT_ERR')
  );
}
