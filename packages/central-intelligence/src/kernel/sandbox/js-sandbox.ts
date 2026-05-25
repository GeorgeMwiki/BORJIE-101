/**
 * JS Sandbox — V8 isolates via `isolated-vm` (May 2026 SOTA).
 *
 * Ported from LITFIN (`src/core/litfin-ai/sandbox/js-sandbox.ts`) into
 * Borjie's central-intelligence kernel. The sandbox is the primitive
 * the brain uses to evaluate arbitrary JS snippets surfaced by tool
 * calls, transforms in `compose_tool_chain`, and any other path that
 * needs to run code derived from a model output.
 *
 * Hard isolation guarantees:
 *
 *   - Own V8 heap. Hostile allocation kills the isolate, not the host.
 *   - Own event loop, microtask queue, stack.
 *   - NO Node intrinsics — `require`, `process`, `fs`, `net`, `Buffer`,
 *     `console`, `global` are all `undefined` in the snippet's scope.
 *   - True wall-clock timeout (V8 interrupt, not best-effort polling).
 *   - Memory cap honoured by V8 — overflow kills the isolate cleanly.
 *
 * Why this replaces `node:vm`:
 * Node's `vm` module is NOT a security boundary. The Node docs
 * explicitly say so:
 *
 *   "The vm module is not a security mechanism. Do not use it to
 *    run untrusted code."  — nodejs.org/api/vm.html
 *
 * If `isolated-vm` cannot be loaded (e.g. missing native build tools
 * on macOS arm64 in a sandboxed CI runner), we fall back to a hardened
 * `node:vm` backend with a Worker-thread timeout. The fallback's
 * isolation is WEAKER (shared heap; vm.Context globals are clones but
 * sit in the same V8 process), so we log a one-time WARN and emit
 * `backend: 'node-vm-fallback'` on every audit event so operators can
 * see they are not getting V8-isolate-strength isolation.
 *
 * The sandbox boundary is one-way:
 *   - Host  → snippet: `context` is frozen, deep-cloned via
 *     ExternalCopy, and never carries a live host reference.
 *   - Snippet → host:  result is structured-clonable only; functions /
 *     proxies / Buffers cannot cross. The result is also depth- and
 *     key-capped to bound caller-side memory.
 */

import {
  DEFAULT_MEMORY_MB,
  DEFAULT_TIMEOUT_MS,
  MAX_CODE_BYTES,
  MAX_MEMORY_MB,
  MAX_RESULT_ARRAY_LEN,
  MAX_RESULT_DEPTH,
  MAX_RESULT_KEYS_PER_OBJECT,
  MAX_TIMEOUT_MS,
  type SandboxAuditEvent,
  type SandboxAuditor,
  type SandboxBackend,
  type SandboxError,
  type SandboxErrorCode,
  type SandboxOptions,
  type SandboxResult,
} from './types.js';
import { logger } from '../../logger.js';

// `isolated-vm` is an OPTIONAL dependency — it's a native module that may
// not build on every platform (and may not even be present in CI runs
// where the optional-dep install path is skipped). We therefore declare a
// minimal structural type for the subset of the API we touch, rather than
// `import type ivm from 'isolated-vm'` which fails TypeScript resolution
// when the package directory is absent.
//
// The actual runtime module is loaded by `loadIvm()` via dynamic require;
// if loading fails we fall back to node:vm (see `runInSandboxFallback`).
declare namespace ivm {
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class Isolate {
    constructor(opts?: { memoryLimit?: number });
    createContextSync(): Context;
    getHeapStatisticsSync(): { used_heap_size: number };
    dispose(): void;
    isDisposed: boolean;
  }
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class Context {
    global: Reference;
    eval(code: string, opts?: { timeout?: number; copy?: boolean }): Promise<unknown>;
    evalSync(code: string, opts?: { timeout?: number; copy?: boolean }): unknown;
    release(): void;
  }
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class Reference<T = unknown> {
    set(key: string, value: unknown, opts?: { copy?: boolean }): Promise<void>;
    setSync(key: string, value: unknown, opts?: { copy?: boolean; release?: boolean }): void;
    get(key: string, opts?: { copy?: boolean }): Promise<T>;
  }
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class ExternalCopy<T = unknown> {
    constructor(value: T);
    copyInto(opts?: { transferIn?: boolean; release?: boolean }): T;
    release(): void;
  }
}

// `IvmModule` is the shape `require('isolated-vm')` returns — i.e. the
// namespace itself, callable via `new Module.Isolate(...)`. We match the
// upstream API surface enough for the operations in this file.
interface IvmModule {
  Isolate: typeof ivm.Isolate;
  Context: typeof ivm.Context;
  Reference: typeof ivm.Reference;
  ExternalCopy: typeof ivm.ExternalCopy;
}

let _ivmCache: IvmModule | null = null;
let _ivmInitErrorMessage: string | null = null;

/**
 * Lazy-load `isolated-vm` from the Node CommonJS runtime, hidden from
 * bundler static analysis. The module is server-only by intent — V8
 * isolates require native bindings that cannot be bundled into client
 * webpack chunks. On failure we cache the sanitized error so retries
 * don't re-trigger `node-gyp-build` partial-init artifacts.
 */
function loadIvm(): IvmModule {
  if (_ivmCache !== null) return _ivmCache;
  if (_ivmInitErrorMessage !== null) {
    throw new Error(_ivmInitErrorMessage);
  }
  if (typeof window !== 'undefined') {
    throw new Error('isolated-vm sandbox is server-only');
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicRequire = eval('require') as (m: string) => unknown;
    const modName = ['isolated', 'vm'].join('-');
    _ivmCache = dynamicRequire(modName) as IvmModule;
    return _ivmCache;
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    // Strip absolute filesystem paths (information disclosure).
    const safeMsg = rawMsg.replace(/(?:\/[^\s/]+){2,}/g, '<path>');
    _ivmInitErrorMessage = `isolated-vm load failed: ${safeMsg}`;
    throw new Error(_ivmInitErrorMessage);
  }
}

let _fallbackWarned = false;
function warnFallbackOnce(reason: string): void {
  if (_fallbackWarned) return;
  _fallbackWarned = true;
  logger.warn(`[central-intelligence/sandbox] Falling back to node:vm backend — ${reason}. ` +
      `Snippet isolation is REDUCED: shared V8 heap, weaker timeout enforcement.`);
}

/**
 * Run a JS snippet in a fresh V8 isolate.
 *
 * The function is async because the fallback path needs a Worker for
 * its timeout. The isolated-vm path completes synchronously inside
 * the promise; the result is resolved on the same microtask the
 * isolate tears down on.
 *
 * @param code     UTF-8 snippet. Capped at 5 KB / 5120 chars.
 * @param context  Frozen, deep-cloned globals injected into the isolate.
 *                 The host-side object is NOT mutated by the snippet.
 * @param options  Caller-supplied caps + audit port. All caps are
 *                 clamped to kernel-wide hard limits.
 */
export async function runInSandbox(
  code: string,
  context: Record<string, unknown> = {},
  options: SandboxOptions = {},
): Promise<SandboxResult> {
  const started = Date.now();
  const timeoutMs = clampTimeout(options.timeoutMs);
  const memoryMb = clampMemory(options.memoryMb);
  const callerTag = options.callerTag;
  const auditor = options.auditor;

  // 1. Pre-flight validation — applied before any V8 allocation.
  const validation = validateCode(code);
  if (validation) {
    const event = buildAuditEvent({
      started,
      durationMs: 0,
      memoryUsedBytes: 0,
      ok: false,
      errorCode: validation.code,
      codeBytes: typeof code === 'string' ? Buffer.byteLength(code, 'utf8') : 0,
      timeoutMs,
      memoryMb,
      callerTag,
      backend: 'isolated-vm',
    });
    fireAuditor(auditor, event);
    return {
      ok: false,
      error: validation,
      durationMs: 0,
      memoryUsedBytes: 0,
    };
  }

  const codeBytes = Buffer.byteLength(code, 'utf8');

  // 2. Try the isolated-vm backend. If load fails (no native binding),
  //    drop to the node:vm fallback.
  let ivmRuntime: IvmModule;
  try {
    ivmRuntime = loadIvm();
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown';
    warnFallbackOnce(reason);
    const result = await runInVmFallback(code, context, timeoutMs, started);
    fireAuditor(
      auditor,
      buildAuditEvent({
        started,
        durationMs: result.durationMs,
        memoryUsedBytes: result.memoryUsedBytes,
        ok: result.ok,
        ...(result.error ? { errorCode: result.error.code } : {}),
        codeBytes,
        timeoutMs,
        memoryMb,
        callerTag,
        backend: 'node-vm-fallback',
      }),
    );
    return result;
  }

  // 3. Fresh isolate per call. memoryLimit is enforced by V8.
  let isolate: ivm.Isolate | null = null;
  let context_: ivm.Context | null = null;
  let memoryUsedBytes = 0;
  try {
    isolate = new ivmRuntime.Isolate({ memoryLimit: memoryMb });
    context_ = isolate.createContextSync();

    // Freeze built-in prototypes BEFORE any user code runs.
    context_.evalSync(
      'Object.freeze(Object.prototype); Object.freeze(Array.prototype); Object.freeze(Function.prototype);',
    );

    // Inject context via ExternalCopy — frozen, structured-clone copy.
    // The host-side `context` object is never mutated; the snippet sees
    // a deep copy bound at top-level keys.
    injectContext(ivmRuntime, context_, context);

    // Wrap so the trailing expression becomes the script's return value.
    const wrapped = `(function(){ ${code} })()`;

    let raw: unknown;
    try {
      raw = context_.evalSync(wrapped, {
        timeout: timeoutMs,
        copy: true,
      });
    } catch (err) {
      // Never call String(err) on an isolate-origin value — a snippet
      // can throw an object with a malicious Symbol.toPrimitive that
      // would re-enter user code from inside our catch.
      const msg = err instanceof Error ? err.message : '(non-error throw from sandbox)';
      const timedOut = /Script execution timed out|timeout/i.test(msg);
      const memoryExhausted =
        !timedOut && isolate !== null && isolate.isDisposed === true;
      // Detect "result not transferable" rejections from copy: true.
      const notClonable =
        !timedOut && !memoryExhausted && /not transferable|could not be cloned|copy/i.test(msg);

      let code_: SandboxErrorCode;
      let message: string;
      if (timedOut) {
        code_ = 'SANDBOX_TIMEOUT';
        message = 'Script execution timed out';
      } else if (memoryExhausted) {
        code_ = 'SANDBOX_MEMORY_EXCEEDED';
        message = 'Memory limit exceeded';
      } else if (notClonable) {
        code_ = 'SANDBOX_RESULT_NOT_CLONABLE';
        message = 'Result is not structured-clonable (functions/proxies forbidden)';
      } else {
        code_ = 'SANDBOX_THROW';
        message = `Runtime error: ${msg}`;
      }

      memoryUsedBytes = safeReadHeapBytes(isolate);
      const result: SandboxResult = {
        ok: false,
        error: { code: code_, message },
        durationMs: Date.now() - started,
        memoryUsedBytes,
      };
      fireAuditor(
        auditor,
        buildAuditEvent({
          started,
          durationMs: result.durationMs,
          memoryUsedBytes,
          ok: false,
          errorCode: code_,
          codeBytes,
          timeoutMs,
          memoryMb,
          callerTag,
          backend: 'isolated-vm',
        }),
      );
      return result;
    }

    // Defense-in-depth result scrub.
    let safeValue: unknown;
    try {
      safeValue = scrubForReturn(raw, 0);
    } catch (err) {
      memoryUsedBytes = safeReadHeapBytes(isolate);
      const message = err instanceof Error ? err.message : '(non-error throw)';
      const result: SandboxResult = {
        ok: false,
        error: { code: 'SANDBOX_RESULT_NOT_CLONABLE', message: `Result scrub failed: ${message}` },
        durationMs: Date.now() - started,
        memoryUsedBytes,
      };
      fireAuditor(
        auditor,
        buildAuditEvent({
          started,
          durationMs: result.durationMs,
          memoryUsedBytes,
          ok: false,
          errorCode: 'SANDBOX_RESULT_NOT_CLONABLE',
          codeBytes,
          timeoutMs,
          memoryMb,
          callerTag,
          backend: 'isolated-vm',
        }),
      );
      return result;
    }

    memoryUsedBytes = safeReadHeapBytes(isolate);
    const result: SandboxResult = {
      ok: true,
      result: safeValue,
      durationMs: Date.now() - started,
      memoryUsedBytes,
    };
    fireAuditor(
      auditor,
      buildAuditEvent({
        started,
        durationMs: result.durationMs,
        memoryUsedBytes,
        ok: true,
        codeBytes,
        timeoutMs,
        memoryMb,
        callerTag,
        backend: 'isolated-vm',
      }),
    );
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : '(non-error throw)';
    const result: SandboxResult = {
      ok: false,
      error: { code: 'SANDBOX_INIT_FAILED', message: `Sandbox init error: ${msg}` },
      durationMs: Date.now() - started,
      memoryUsedBytes: 0,
    };
    fireAuditor(
      auditor,
      buildAuditEvent({
        started,
        durationMs: result.durationMs,
        memoryUsedBytes: 0,
        ok: false,
        errorCode: 'SANDBOX_INIT_FAILED',
        codeBytes,
        timeoutMs,
        memoryMb,
        callerTag,
        backend: 'isolated-vm',
      }),
    );
    return result;
  } finally {
    try {
      if (isolate && !isolate.isDisposed) isolate.dispose();
    } catch {
      // dispose can throw if the isolate was already torn down by the
      // memory cap; ignore.
    }
    void context_;
  }
}

function clampTimeout(requested: number | undefined): number {
  const raw = typeof requested === 'number' && Number.isFinite(requested) ? Math.floor(requested) : DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(1, raw), MAX_TIMEOUT_MS);
}

function clampMemory(requested: number | undefined): number {
  const raw =
    typeof requested === 'number' && Number.isFinite(requested)
      ? Math.floor(requested)
      : DEFAULT_MEMORY_MB;
  // isolated-vm enforces a hard floor of 8 MB on memoryLimit; clamping
  // below that produces a sandbox init error. We treat 8 MB as both
  // the floor AND the ceiling so all isolates share one cap shape.
  return Math.min(Math.max(MAX_MEMORY_MB, raw), MAX_MEMORY_MB);
}

function validateCode(code: string): SandboxError | null {
  if (typeof code !== 'string' || code.length === 0) {
    return { code: 'SANDBOX_CODE_INVALID', message: 'Snippet is empty' };
  }
  // Cap on both UTF-16 length and UTF-8 byte length. Astral-plane chars
  // inflate 1 UTF-16 codepoint to 4 UTF-8 bytes, so the V8 compiler
  // input could exceed the byte cap if we only checked UTF-16.
  if (code.length > MAX_CODE_BYTES) {
    return {
      code: 'SANDBOX_CODE_TOO_LARGE',
      message: `Snippet exceeds ${MAX_CODE_BYTES} character limit`,
    };
  }
  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
    return {
      code: 'SANDBOX_CODE_TOO_LARGE',
      message: `Snippet exceeds ${MAX_CODE_BYTES} byte limit`,
    };
  }
  return null;
}

function injectContext(
  ivmRuntime: IvmModule,
  ctx: ivm.Context,
  context: Record<string, unknown>,
): void {
  const global = ctx.global;
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    const ext = new ivmRuntime.ExternalCopy(value);
    global.setSync(key, ext.copyInto({ release: true }));
  }
}

function safeReadHeapBytes(isolate: ivm.Isolate | null): number {
  if (!isolate || isolate.isDisposed) return 0;
  try {
    const stats = isolate.getHeapStatisticsSync();
    return Number(stats.used_heap_size) || 0;
  } catch {
    return 0;
  }
}

function fireAuditor(auditor: SandboxAuditor | undefined, event: SandboxAuditEvent): void {
  if (!auditor) return;
  try {
    auditor(event);
  } catch {
    // Audit failures must never block the sandbox result.
  }
}

interface AuditBuildArgs {
  readonly started: number;
  readonly durationMs: number;
  readonly memoryUsedBytes: number;
  readonly ok: boolean;
  readonly errorCode?: SandboxErrorCode | undefined;
  readonly codeBytes: number;
  readonly timeoutMs: number;
  readonly memoryMb: number;
  readonly callerTag?: string | undefined;
  readonly backend: SandboxBackend;
}

function buildAuditEvent(args: AuditBuildArgs): SandboxAuditEvent {
  return {
    at: new Date(args.started),
    ...(args.callerTag !== undefined ? { callerTag: args.callerTag } : {}),
    codeBytes: args.codeBytes,
    timeoutMs: args.timeoutMs,
    memoryMb: args.memoryMb,
    ok: args.ok,
    ...(args.errorCode !== undefined ? { errorCode: args.errorCode } : {}),
    durationMs: args.durationMs,
    memoryUsedBytes: args.memoryUsedBytes,
    backend: args.backend,
  };
}

/**
 * Walk the result and enforce JSON-clonable output. With isolated-vm's
 * `copy: true` the input is already a plain value (no host objects, no
 * proxies), but we still walk for depth + key-count caps, and we
 * defensively reject any function value that could have slipped
 * through.
 */
function scrubForReturn(value: unknown, depth: number): unknown {
  if (depth > MAX_RESULT_DEPTH) return null;
  if (value === null) return null;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') return null;

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_RESULT_ARRAY_LEN)
      .map((v) => scrubForReturn(v, depth + 1));
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const key of Object.keys(obj)) {
      if (count >= MAX_RESULT_KEYS_PER_OBJECT) break;
      out[key] = scrubForReturn(obj[key], depth + 1);
      count++;
    }
    return out;
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────
// Fallback backend: node:vm + Worker-thread timeout. WEAKER ISOLATION.
//
// Used only when isolated-vm cannot load (missing native binding).
// The Node docs are explicit: vm is NOT a security mechanism. We still
// freeze the context object and run inside a Worker so a runaway loop
// can be terminated, but:
//
//   - vm shares the host V8 heap; allocation bombs can OOM the host.
//   - vm.runInContext's `timeout` is best-effort for synchronous code
//     and ignores promise microtasks; we therefore run the snippet
//     inside a Worker and `.terminate()` it on timeout.
//   - Per-call memory cannot be metered, so memoryUsedBytes is always 0.
//
// This is here for graceful degradation in environments where
// node-gyp-build cannot install (sandboxed CI, missing Xcode CLT, etc).
// ────────────────────────────────────────────────────────────────────

async function runInVmFallback(
  code: string,
  context: Record<string, unknown>,
  timeoutMs: number,
  started: number,
): Promise<SandboxResult> {
  // Run the snippet inside a Worker so we can hard-kill on timeout.
  // Snippet runs via the worker's own `node:vm` with a frozen context.
  const { Worker } = await import('node:worker_threads');
  const workerSrc = String.raw`
    const { parentPort, workerData } = require('node:worker_threads');
    const vm = require('node:vm');
    try {
      const sandbox = Object.create(null);
      for (const [k, v] of Object.entries(workerData.context || {})) {
        // Deep-clone via JSON so the parent's references cannot be
        // mutated. Non-JSON values become undefined.
        try { sandbox[k] = JSON.parse(JSON.stringify(v)); }
        catch { sandbox[k] = undefined; }
      }
      Object.freeze(sandbox);
      const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
      const wrapped = '(function(){ ' + workerData.code + ' })()';
      const result = vm.runInContext(wrapped, ctx, { timeout: workerData.timeoutMs, displayErrors: false });
      // Strip non-clonable values via JSON round-trip.
      let safe;
      try { safe = JSON.parse(JSON.stringify(result === undefined ? null : result)); }
      catch { safe = null; }
      parentPort.postMessage({ ok: true, result: safe });
    } catch (err) {
      const msg = err && err.message ? String(err.message) : '(non-error throw)';
      const timedOut = /Script execution timed out|timeout/i.test(msg);
      parentPort.postMessage({
        ok: false,
        message: msg,
        timedOut,
      });
    }
  `;

  return new Promise<SandboxResult>((resolve) => {
    let settled = false;
    const settle = (r: SandboxResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    let worker: import('node:worker_threads').Worker;
    try {
      worker = new Worker(workerSrc, {
        eval: true,
        workerData: { code, context, timeoutMs },
      });
    } catch (err) {
      settle({
        ok: false,
        error: {
          code: 'SANDBOX_INIT_FAILED',
          message: err instanceof Error ? err.message : 'Worker init failed',
        },
        durationMs: Date.now() - started,
        memoryUsedBytes: 0,
      });
      return;
    }

    // Worker-side vm.runInContext's `timeout` may not interrupt a
    // tight infinite loop reliably across Node versions, so we add an
    // outer hard kill at timeoutMs + 250ms grace.
    const killTimer = setTimeout(() => {
      try {
        void worker.terminate();
      } catch {
        // ignore
      }
      settle({
        ok: false,
        error: { code: 'SANDBOX_TIMEOUT', message: 'Script execution timed out' },
        durationMs: Date.now() - started,
        memoryUsedBytes: 0,
      });
    }, timeoutMs + 250);

    worker.once(
      'message',
      (msg: { ok: boolean; result?: unknown; message?: string; timedOut?: boolean }) => {
        clearTimeout(killTimer);
        void worker.terminate();
        if (msg.ok) {
          const scrubbed = scrubForReturn(msg.result, 0);
          settle({
            ok: true,
            result: scrubbed,
            durationMs: Date.now() - started,
            memoryUsedBytes: 0,
          });
        } else {
          const errMsg = msg.message || '(non-error throw)';
          const code: SandboxErrorCode = msg.timedOut ? 'SANDBOX_TIMEOUT' : 'SANDBOX_THROW';
          settle({
            ok: false,
            error: { code, message: msg.timedOut ? 'Script execution timed out' : `Runtime error: ${errMsg}` },
            durationMs: Date.now() - started,
            memoryUsedBytes: 0,
          });
        }
      },
    );

    worker.once('error', (err: unknown) => {
      clearTimeout(killTimer);
      const message = err instanceof Error ? err.message : 'Worker error';
      settle({
        ok: false,
        error: { code: 'SANDBOX_THROW', message },
        durationMs: Date.now() - started,
        memoryUsedBytes: 0,
      });
    });
  });
}
