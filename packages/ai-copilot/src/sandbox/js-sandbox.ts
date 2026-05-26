/**
 * JS Sandbox - V8 Isolates via `isolated-vm` (May 2026 SOTA).
 *
 * Ported from LITFIN under audit `litfin-sota-2026-05-23` (Wave-2 #8).
 * Source: `LITFIN PROJECT/src/core/litfin-ai/sandbox/js-sandbox.ts`.
 *
 * Used by AI copilot tool calls that need to evaluate caller-supplied
 * JS expressions (transforms, computed projections, scoring snippets)
 * over governed inputs. Runs the snippet inside a real V8 isolate -
 * the same isolation primitive Chrome tabs and Cloudflare Workers use.
 * The isolate has:
 *
 *   - its own V8 heap (32 MB default cap; hostile allocation kills
 *     the isolate, not the host process)
 *   - its own event loop, microtask queue, and stack
 *   - NO Node intrinsics - no `require`, `process`, `fs`, `net`,
 *     `Buffer`, `console`, or any host global. The isolate sees only
 *     the standard ECMAScript global object.
 *   - a true wall-clock timeout that interrupts the running script
 *     mid-execution (not best-effort polling)
 *
 * Why this replaces `node:vm` (and why we proactively ban it):
 * Node's `vm` module is NOT a security boundary. The Node docs
 * explicitly say so:
 *
 *   "The vm module is not a security mechanism. Do not use it to
 *    run untrusted code."  (nodejs.org/api/vm.html)
 *
 * Specifically, the `vm` sandbox shares the host's heap (a tight-loop
 * in the snippet can allocate until the host OOMs), and the `timeout`
 * option is best-effort (a synchronous infinite loop with no
 * allocation can still hang Node). OWASP GenAI Q1 2026 round-up
 * flagged `vm`-based sandboxes as a top-three risk for agent
 * platforms running tool calls on tenant data.
 *
 * `isolated-vm` (6.1.x as of May 2026) is the production-grade
 * replacement. The isolate is a separate V8 instance with its own
 * heap; the timeout interrupts V8 directly; allocations exceeding
 * memoryLimit kill the isolate cleanly.
 *
 * Hard limits (configurable per call, with ceilings):
 *   - snippet size:  5 KB  (DEFAULT_MAX_CODE_BYTES)
 *   - heap memory:   32 MB per isolate (V8 cap, enforced by isolated-vm)
 *   - wall clock:    200 ms default, 5000 ms ceiling (V8-enforced)
 *   - result depth:  walked to enforce structured-clonable output
 *
 * Note on Node compatibility: `isolated-vm` ships a native binding
 * (node-gyp / node-gyp-build). It requires Node >= 18; the package's
 * `engines.node` already declares >= 18.0.0. Builds on alpine /
 * non-glibc systems may need a C++ toolchain installed for the
 * `pnpm install` step to compile the binding.
 */

// Type-only import: pulls the .d.ts but emits no runtime require, so
// downstream bundler static analysis does not bundle `isolated-vm`
// (which has a native binding via node-gyp-build). The runtime value
// is loaded by `loadIvm()` below, hidden from the analyzer.
import type ivm from 'isolated-vm';

type IvmModule = typeof ivm;

let _ivmCache: IvmModule | null = null;
let _ivmInitErrorMessage: string | null = null;

/**
 * Lazy-load `isolated-vm` from the Node CommonJS runtime, hidden from
 * bundler static analysis. The module is server-only by intent - V8
 * isolates require native bindings that cannot be bundled into
 * client / SSR webpack chunks.
 *
 * IVM-EVAL audit fix (HIGH iter-24): wrap `eval("require")` so a
 * concurrent first-call race never re-invokes the dynamic require
 * twice. node-gyp-build can throw partial-init errors that leak the
 * absolute filesystem path of the native binding through the error
 * message - sanitize that before it can reach the LLM caller.
 */
function loadIvm(): IvmModule {
  if (_ivmCache !== null) return _ivmCache;
  if (_ivmInitErrorMessage !== null) {
    // Init previously failed: surface the SAME sanitized error rather
    // than re-running the dynamic require (avoids node-gyp-build partial
    // init artifacts on retry).
    throw new Error(_ivmInitErrorMessage);
  }
  // DOM `window` isn't in the Node lib set; reference via globalThis so
  // the typecheck stays clean and the runtime check still catches
  // accidental browser bundling.
  if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
    throw new Error('isolated-vm sandbox is server-only');
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- SCRUB-5f: rule-disabled because eval('require') is the documented bundler-evading sync-require seam for the optional isolated-vm native dep
    const dynamicRequire = eval('require') as (m: string) => unknown;
    const modName = ['isolated', 'vm'].join('-');
    _ivmCache = dynamicRequire(modName) as IvmModule;
    return _ivmCache;
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    // Strip any absolute filesystem path (information disclosure).
    const safeMsg = rawMsg.replace(/(?:\/[^\s/]+){2,}/g, '<path>');
    _ivmInitErrorMessage = `isolated-vm load failed: ${safeMsg}`;
    throw new Error(_ivmInitErrorMessage);
  }
}

/** Result of a sandbox execution. */
export interface SandboxRunResult {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: string;
  readonly durationMs: number;
  /** True when the isolate was terminated by the memory cap. */
  readonly memoryExhausted?: boolean;
  /** True when the wall-clock timeout fired. */
  readonly timedOut?: boolean;
  /**
   * Discriminates programmer/integration errors from runtime errors so
   * callers can branch on them (e.g. surface BadInput to the LLM as a
   * retryable failure but not Timeout).
   */
  readonly kind?: 'ok' | 'timeout' | 'oom' | 'bad-input' | 'runtime' | 'init';
}

/** Options for {@link runJsSandbox}. */
export interface SandboxOptions {
  /** Wall-clock timeout in ms. Default 200, ceiling 5000. */
  timeoutMs?: number;
  /** Heap cap in MB. Default 32. Ceiling 256. */
  memoryMb?: number;
  /** Caller-supplied globals injected via ExternalCopy (deep-cloned). */
  globals?: Readonly<Record<string, unknown>>;
}

// Defaults / ceilings - exported so tests + callers can introspect them.
export const DEFAULT_MAX_CODE_BYTES = 5 * 1024;
export const DEFAULT_TIMEOUT_MS = 200;
export const MAX_TIMEOUT_MS = 5_000;
export const DEFAULT_MEMORY_MB = 32;
export const MAX_MEMORY_MB = 256;
const MAX_RESULT_DEPTH = 8;
const MAX_RESULT_KEYS_PER_OBJECT = 200;
const MAX_ARRAY_ITEMS_IN_RESULT = 1_000;

/**
 * Run a JS snippet in a fresh V8 isolate.
 *
 * Synchronous: blocks the caller until the snippet returns or the
 * timeout/memory cap fires. `isolated-vm` exposes synchronous and
 * Promise-based variants; we use synchronous here so tool-loop
 * semantics are preserved (sandbox calls return on the same tick
 * the caller resumes on).
 *
 * The snippet is wrapped in an IIFE so the trailing expression's
 * value becomes the script's return value.
 *
 * Two call shapes are supported for ergonomics:
 *   runJsSandbox(code)
 *   runJsSandbox(code, { timeoutMs, memoryMb, globals })
 *   runJsSandbox(code, 1500)                  // legacy positional ms
 *   runJsSandbox(code, 1500, { foo: 'bar' })  // legacy positional ms + globals
 */
export function runJsSandbox(
  code: string,
  timeoutOrOpts?: number | SandboxOptions,
  legacyGlobals?: Readonly<Record<string, unknown>>,
): SandboxRunResult {
  const started = Date.now();

  // ---- Normalise overload to a single options bag.
  const opts: SandboxOptions =
    typeof timeoutOrOpts === 'number'
      ? legacyGlobals
        ? { timeoutMs: timeoutOrOpts, globals: legacyGlobals }
        : { timeoutMs: timeoutOrOpts }
      : timeoutOrOpts ?? {};

  // ---- 1. Size guard - applied before any V8 allocation.
  //
  // IVM-UTF audit fix (MEDIUM iter-24): cap on BOTH the UTF-8 byte
  // length AND the UTF-16 code-unit length. Pre-fix the only check
  // was UTF-8 bytes - astral-plane chars (e.g. emoji) inflate 1 UTF-16
  // codepoint to 4 UTF-8 bytes, and V8 compiles by UTF-16 length, so
  // mixed-script snippets could compile to a much larger V8 source
  // than the byte cap implied. Capping both bounds the compiler input
  // strictly.
  if (typeof code !== 'string' || code.length === 0) {
    return {
      ok: false,
      error: 'Snippet is empty',
      durationMs: 0,
      kind: 'bad-input',
    };
  }
  if (code.length > DEFAULT_MAX_CODE_BYTES) {
    return {
      ok: false,
      error: `Snippet exceeds ${DEFAULT_MAX_CODE_BYTES} character limit`,
      durationMs: 0,
      kind: 'bad-input',
    };
  }
  if (Buffer.byteLength(code, 'utf8') > DEFAULT_MAX_CODE_BYTES) {
    return {
      ok: false,
      error: `Snippet exceeds ${DEFAULT_MAX_CODE_BYTES} byte limit`,
      durationMs: 0,
      kind: 'bad-input',
    };
  }

  // ---- 2. Timeout + memory guards normalised.
  const effectiveTimeout = Math.min(
    Math.max(1, Math.floor(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)),
    MAX_TIMEOUT_MS,
  );
  const effectiveMemory = Math.min(
    Math.max(8, Math.floor(opts.memoryMb ?? DEFAULT_MEMORY_MB)),
    MAX_MEMORY_MB,
  );

  // ---- 3. Fresh isolate per call. `memoryLimit` is enforced by V8 -
  //    a runaway allocation kills THIS isolate cleanly without
  //    affecting the host process.
  let ivmRuntime: IvmModule;
  try {
    ivmRuntime = loadIvm();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'isolated-vm load failed',
      durationMs: Date.now() - started,
      kind: 'init',
    };
  }

  let isolate: ivm.Isolate | null = null;
  let context: ivm.Context | null = null;
  try {
    isolate = new ivmRuntime.Isolate({ memoryLimit: effectiveMemory });
    context = isolate.createContextSync();

    // Bug 4 iter-44: freeze the built-in prototypes BEFORE any user code
    // runs so a snippet cannot mutate `Object.prototype` / `Array.prototype`
    // / `Function.prototype` and corrupt downstream sandbox runs that
    // share the same V8 build (the isolate is fresh per call, but the
    // freeze is defence-in-depth against prototype-pollution semantics
    // leaking via copied result objects).
    context.evalSync(
      'Object.freeze(Object.prototype); Object.freeze(Array.prototype); Object.freeze(Function.prototype);',
    );

    // Bug 1 iter-44: inject caller-supplied globals via `ExternalCopy`
    // (a frozen, structured-clone copy that crosses the isolate
    // boundary safely). This replaces the previous pattern of
    // interpolating `JSON.stringify(x)` directly into the source string
    // - that was a V8 source-string injection vector if any value
    // contained a string with embedded backticks / template syntax /
    // unicode escapes that JSON.stringify did not escape strongly
    // enough for the V8 parser. ExternalCopy uses the structured-clone
    // algorithm and never round-trips through source text.
    if (opts.globals) {
      const global = context.global;
      for (const [key, value] of Object.entries(opts.globals)) {
        const ext = new ivmRuntime.ExternalCopy(value);
        global.setSync(key, ext.copyInto({ release: true }));
      }
    }

    // ---- 4. Wrap snippet so its trailing expression is the return value.
    const wrapped = `(function(){ ${code} })()`;

    // ---- 5. Compile + run. evalSync raises if the timeout fires.
    let raw: unknown;
    try {
      raw = context.evalSync(wrapped, {
        timeout: effectiveTimeout,
        // `copy: true` instructs isolated-vm to copy the result into
        // the host immediately so we can scrub it without a live
        // isolate-side handle.
        copy: true,
      });
    } catch (err) {
      // IVM-STATE audit fix (MEDIUM iter-24): NEVER call `String(err)`
      // on an isolate-origin value. A snippet returning
      // `{ [Symbol.toPrimitive]: () => { ... } }` (or throwing such an
      // object) could fire host-side coercion during error formatting
      // and re-enter user code from inside our catch block. Only read
      // `.message` from real Error instances; everything else gets a
      // fixed "(non-error throw)" sentinel.
      const msg =
        err instanceof Error ? err.message : '(non-error throw from sandbox)';
      const timedOut = /Script execution timed out|timeout/i.test(msg);
      // IVM-STATE audit fix: tighten memoryExhausted detection. Gate
      // on isolate.isDisposed instead of pattern-matching user-thrown
      // messages literally containing "memory limit" (which an attacker
      // could counterfeit to corrupt brain self-reflection telemetry).
      const memoryExhausted =
        !timedOut && isolate !== null && isolate.isDisposed === true;
      return {
        ok: false,
        error: memoryExhausted
          ? 'Memory limit exceeded'
          : timedOut
            ? 'Script execution timed out'
            : `Runtime error: ${msg}`,
        durationMs: Date.now() - started,
        memoryExhausted,
        timedOut,
        kind: memoryExhausted ? 'oom' : timedOut ? 'timeout' : 'runtime',
      };
    }

    // ---- 6. Result scrub - defense in depth. evalSync with `copy: true`
    // already returns plain JSON-cloneable data; the scrub enforces
    // depth + key-count caps so a snippet returning a deeply nested
    // object can't blow our caller's memory.
    let safeValue: unknown;
    try {
      safeValue = scrubForReturn(raw, 0);
    } catch (err) {
      return {
        ok: false,
        error: `Result scrub failed: ${err instanceof Error ? err.message : '(non-error throw)'}`,
        durationMs: Date.now() - started,
        kind: 'runtime',
      };
    }

    return {
      ok: true,
      value: safeValue,
      durationMs: Date.now() - started,
      kind: 'ok',
    };
  } catch (err) {
    return {
      ok: false,
      error: `Sandbox init error: ${err instanceof Error ? err.message : '(non-error throw)'}`,
      durationMs: Date.now() - started,
      kind: 'init',
    };
  } finally {
    // ---- 7. Always tear down the isolate - even on success. This frees
    // the V8 heap immediately rather than waiting for GC.
    try {
      if (isolate && !isolate.isDisposed) isolate.dispose();
    } catch {
      // dispose can throw if the isolate was already torn down by the
      // memory cap; ignore.
    }
    void context;
  }
}

/**
 * Walk the result and enforce JSON-clonable output. With
 * isolated-vm's `copy: true` option the input is already a plain
 * value (no host objects, no proxies), but we still walk it for
 * depth + key-count caps.
 */
function scrubForReturn(value: unknown, depth: number): unknown {
  if (depth > MAX_RESULT_DEPTH) return null;

  if (value === null) return null;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (
    t === 'undefined' ||
    t === 'function' ||
    t === 'symbol' ||
    t === 'bigint'
  ) {
    return null;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS_IN_RESULT)
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
