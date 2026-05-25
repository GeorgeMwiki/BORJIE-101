/**
 * Typst renderer — real implementation.
 *
 * Typst is the modern LaTeX alternative (Rust-based, 10–100× faster
 * compile, single-pass reference resolution). The research report
 * picks it for court-formatted legal docs (eviction notice, rent
 * increase notice, demand letter) where speed + clean error messages
 * matter.
 *
 * Two execution modes, tried in order:
 *
 *   1. **Local binary** — spawn `typst compile <input> -` and pipe
 *      stdout (the PDF bytes). Selected when `TYPST_BINARY` resolves
 *      to a real executable.
 *   2. **HTTP server** — POST to `${TYPST_SERVER_URL}/compile` with
 *      `{ source, inputs }`. Selected when no local binary but
 *      `TYPST_SERVER_URL` is set.
 *
 * If neither is configured (and `useStub` is the default), the
 * deterministic stub kicks in so the test suite passes offline.
 *
 * Env (read LAZILY on first render):
 *
 *   TYPST_BINARY        path to `typst` binary. Default: `typst`
 *                       (resolved via PATH).
 *   TYPST_SERVER_URL    HTTP endpoint of a typst render server.
 *   TYPST_TIMEOUT_MS    per-render timeout. Default: 60000.
 *
 * Upstream failures are returned as structured `RendererError` — the
 * renderer never throws on a missing binary, non-200 HTTP, or
 * non-zero exit code.
 *
 * Refs:
 *   - https://typst.app/docs/reference/foundations/sys/
 *     (sys.inputs documentation for `--input` flag)
 *   - https://github.com/typst/typst (CLI reference)
 *   - https://typst.app/docs/tutorial/
 *   - .audit/litfin-sota-2026-05-23/19-document-generation.md §4
 */

import type {
  Renderer,
  RendererInput,
  RendererOutput,
} from '../types.js';
import { errorOutput, stubRender } from './carbone-renderer.js';

/** Default binary name — `typst` resolved via PATH. */
export const DEFAULT_TYPST_BINARY = 'typst';
/** Default per-render timeout (60s). */
export const DEFAULT_TYPST_TIMEOUT_MS = 60_000;

/** Spawn function the real renderer uses. Pluggable for tests. */
export type TypstSpawnFn = (
  binary: string,
  args: ReadonlyArray<string>,
  options: { cwd: string; timeoutMs: number },
) => Promise<{ stdout: Uint8Array; stderr: string; exitCode: number | null }>;

export interface TypstRendererOptions {
  /**
   * Explicit binary path. Overrides `TYPST_BINARY`. Pass empty string
   * to force stub or server-only mode.
   */
  readonly typstBinary?: string;
  /** Explicit server URL. Overrides `TYPST_SERVER_URL`. */
  readonly typstServerUrl?: string;
  /** Temp directory for spawned compile. Default: `/tmp`. */
  readonly tempDir?: string;
  /** Per-render timeout. Overrides `TYPST_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
  /** Force stub mode regardless of env. */
  readonly useStub?: boolean;
  /** Spawn impl. Defaults to `node:child_process` wrapper. */
  readonly spawn?: TypstSpawnFn;
  /** Fetch impl for HTTP fallback. Defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export class TypstRenderer implements Renderer {
  public readonly id = 'typst';
  private readonly options: TypstRendererOptions;

  constructor(options: TypstRendererOptions = {}) {
    this.options = options;
  }

  private resolveBinary(): string | undefined {
    if (this.options.typstBinary === '') return undefined;
    if (this.options.typstBinary) return this.options.typstBinary;
    const env = process.env.TYPST_BINARY;
    if (env === '') return undefined;
    return env ?? DEFAULT_TYPST_BINARY;
  }

  private resolveServerUrl(): string | undefined {
    if (this.options.typstServerUrl === '') return undefined;
    if (this.options.typstServerUrl) return this.options.typstServerUrl;
    const env = process.env.TYPST_SERVER_URL;
    if (env === '') return undefined;
    return env;
  }

  private resolveTimeout(): number {
    if (typeof this.options.timeoutMs === 'number') {
      return this.options.timeoutMs;
    }
    const envTimeout = Number(process.env.TYPST_TIMEOUT_MS);
    if (Number.isFinite(envTimeout) && envTimeout > 0) return envTimeout;
    return DEFAULT_TYPST_TIMEOUT_MS;
  }

  /**
   * True when no real execution path is configured. Note: this only
   * tells you what the renderer *will* do — the binary may still
   * resolve to "not found" at spawn time, which surfaces as a
   * structured error.
   */
  public isStub(): boolean {
    if (this.options.useStub) return true;
    return this.resolveBinary() === undefined && this.resolveServerUrl() === undefined;
  }

  async render<TData>(input: RendererInput<TData>): Promise<RendererOutput> {
    if (this.isStub()) {
      return stubRender(this.id, input);
    }
    if (input.format !== 'pdf') {
      return errorOutput({
        code: 'unsupported_format',
        message: `TypstRenderer only emits PDF; requested format=${input.format}`,
        origin: this.id,
      });
    }

    const binary = this.resolveBinary();
    if (binary) {
      return this.spawnRender(binary, input);
    }
    const serverUrl = this.resolveServerUrl()!;
    return this.serverRender(serverUrl, input);
  }

  private async spawnRender<TData>(
    binary: string,
    input: RendererInput<TData>,
  ): Promise<RendererOutput> {
    const tempDir = this.options.tempDir ?? '/tmp';
    const spawn = this.options.spawn ?? defaultSpawn;
    const timeoutMs = this.resolveTimeout();

    // `typst compile <input> -` writes the PDF to stdout; we pass the
    // user data through `--input data=<json>` so the template can read
    // it as `sys.inputs.data`.
    const args = [
      'compile',
      input.templateRef,
      '-',
      '--input',
      `data=${JSON.stringify(input.data)}`,
    ];

    try {
      const result = await spawn(binary, args, { cwd: tempDir, timeoutMs });
      if (result.exitCode !== 0) {
        return errorOutput({
          code: 'binary_failed',
          message: `typst compile exited ${result.exitCode}: ${result.stderr.slice(0, 500)}`,
          origin: this.id,
        });
      }
      return { buffer: result.stdout, mimeType: 'application/pdf' };
    } catch (err) {
      const code = isMissingBinary(err) ? 'binary_not_found' : 'binary_failed';
      return errorOutput({
        code,
        message:
          code === 'binary_not_found'
            ? `typst binary '${binary}' not found on PATH`
            : `typst spawn failed: ${(err as Error).message ?? String(err)}`,
        origin: this.id,
      });
    }
  }

  private async serverRender<TData>(
    serverUrl: string,
    input: RendererInput<TData>,
  ): Promise<RendererOutput> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeoutMs = this.resolveTimeout();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${serverUrl}/compile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/pdf' },
        body: JSON.stringify({ source: input.templateRef, inputs: { data: input.data } }),
        signal: controller.signal,
      });
      if (!response.ok) {
        return errorOutput({
          code: 'upstream_http_error',
          message: `typst-server returned ${response.status} ${response.statusText}`,
          status: response.status,
          origin: this.id,
        });
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      return { buffer, mimeType: 'application/pdf' };
    } catch (err) {
      const code = isAbortError(err) ? 'upstream_timeout' : 'upstream_network_error';
      return errorOutput({
        code,
        message:
          code === 'upstream_timeout'
            ? `typst-server request aborted after ${timeoutMs}ms`
            : `typst-server request failed: ${(err as Error).message ?? String(err)}`,
        origin: this.id,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Default child_process-based spawn. Imported lazily so the bundle
 * stays tree-shakable and tests never accidentally exec real binaries
 * (the unit-test suite always injects its own `spawn`).
 */
async function defaultSpawn(
  binary: string,
  args: ReadonlyArray<string>,
  options: { cwd: string; timeoutMs: number },
): Promise<{ stdout: Uint8Array; stderr: string; exitCode: number | null }> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [...args], {
      cwd: options.cwd,
      timeout: options.timeoutMs,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: string[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) =>
      stderrChunks.push(chunk.toString('utf8')),
    );
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({
        stdout: new Uint8Array(Buffer.concat(stdoutChunks)),
        stderr: stderrChunks.join(''),
        exitCode,
      });
    });
  });
}

function isMissingBinary(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  return code === 'ENOENT';
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || (err as { code?: string }).code === 'ABORT_ERR')
  );
}
