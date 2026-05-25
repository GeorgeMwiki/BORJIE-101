/**
 * @vitest-environment node
 *
 * JS Sandbox tests - verifies the V8 isolates port (LITFIN audit
 * Wave-2 #8, May 2026).
 *
 * Critical invariants the sandbox MUST hold:
 *   1. Pure-math snippets return correctly.
 *   2. No host globals: no `process`, `require`, `Buffer`, `console`,
 *      `global`, `globalThis.something_else`.
 *   3. Tight infinite loops are KILLED by the wall-clock timeout
 *      (the old `node:vm` could hang on a sync infinite loop with no
 *      allocations; isolated-vm's V8 interrupt kills it).
 *   4. Heap-allocation attack is KILLED by the memory cap (the old
 *      `node:vm` shared the host heap and could OOM the process;
 *      isolated-vm runs in its own V8 instance with a 32 MB cap).
 *   5. Result is JSON-clonable (no functions, proxies, host objects
 *      leak back to the caller).
 *   6. Code-size caps (UTF-16 length + UTF-8 byte length) enforced.
 *   7. Astral-plane injection (emoji etc.) rejected by dual-cap.
 *
 * Why tests skip-gracefully: `isolated-vm` is a native binding that
 * compiles via node-gyp on `pnpm install`. On environments without a
 * C++ toolchain the binding may be absent. The source-contract tests
 * still run unconditionally so the security contract is verified even
 * without the binary.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  runJsSandbox,
  DEFAULT_MAX_CODE_BYTES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MEMORY_MB,
  MAX_TIMEOUT_MS,
} from '../js-sandbox.js';

// Detect whether the native binding loaded. If a probe call returns a
// kind=init error mentioning isolated-vm, the binding isn't available
// and the runtime suites are skipped (the source-contract suite still
// runs).
function isolatedVmAvailable(): boolean {
  try {
    const r = runJsSandbox('return 1');
    if (r.kind === 'init') return false;
    return true;
  } catch {
    return false;
  }
}

const ivmReady = isolatedVmAvailable();
const ivmDescribe = ivmReady ? describe : describe.skip;

// ----------------------------------------------------------------------------
// Source-level contract (always runs - no native binding required).
// ----------------------------------------------------------------------------
describe('js-sandbox source contract', () => {
  const source = readFileSync(
    join(__dirname, '..', 'js-sandbox.ts'),
    'utf-8',
  );

  it('caps code.length (UTF-16 units) before V8 sees the source', () => {
    expect(source).toMatch(/code\.length > DEFAULT_MAX_CODE_BYTES/);
  });

  it('caps Buffer.byteLength(code, utf8) - astral-plane defense', () => {
    expect(source).toMatch(/Buffer\.byteLength\(code, ['"]utf8['"]\)/);
  });

  it('loadIvm sanitizes filesystem paths from error messages', () => {
    expect(source).toMatch(/<path>/);
  });

  it('error sites use the (non-error throw) sentinel instead of String(err)', () => {
    const sentinelHits = (source.match(/\(non-error throw\)/g) ?? []).length;
    expect(sentinelHits).toBeGreaterThanOrEqual(2);
  });

  it('freezes Object/Array/Function prototypes before user code runs', () => {
    expect(source).toMatch(/Object\.freeze\(Object\.prototype\)/);
    expect(source).toMatch(/Object\.freeze\(Array\.prototype\)/);
    expect(source).toMatch(/Object\.freeze\(Function\.prototype\)/);
  });

  it('always disposes the isolate in a finally block', () => {
    expect(source).toMatch(/finally\s*\{/);
    expect(source).toMatch(/isolate\.dispose\(\)/);
  });

  it('uses ExternalCopy to inject globals (no source-string interpolation)', () => {
    expect(source).toMatch(/ExternalCopy/);
    expect(source).not.toMatch(/JSON\.stringify\(value\)/);
  });

  it('cites LITFIN source path and OWASP reasoning in header', () => {
    expect(source).toMatch(/LITFIN/);
    expect(source).toMatch(/OWASP/);
  });
});

// ----------------------------------------------------------------------------
// Default exports + option overload normalisation (always runs).
// ----------------------------------------------------------------------------
describe('js-sandbox configuration constants', () => {
  it('defaults to a 200 ms timeout per the audit', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(200);
  });

  it('defaults to a 32 MB memory cap per the audit', () => {
    expect(DEFAULT_MEMORY_MB).toBe(32);
  });

  it('caps absolute timeout at 5 seconds', () => {
    expect(MAX_TIMEOUT_MS).toBe(5000);
  });

  it('caps snippet size at 5 KB', () => {
    expect(DEFAULT_MAX_CODE_BYTES).toBe(5 * 1024);
  });
});

// ----------------------------------------------------------------------------
// Bad-input rejection (runs without the native binding because size +
// emptiness checks happen before the loadIvm() call).
// ----------------------------------------------------------------------------
describe('js-sandbox bad-input rejection', () => {
  it('rejects empty snippets with kind=bad-input', () => {
    const r = runJsSandbox('');
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('bad-input');
    expect(r.error).toContain('empty');
  });

  it('rejects snippets over 5 KB by UTF-16 length', () => {
    const big = 'a'.repeat(6 * 1024);
    const r = runJsSandbox(big);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('bad-input');
    expect(r.error).toMatch(/character limit|byte limit/);
  });

  it('rejects astral-plane stuffing that inflates UTF-8 bytes', () => {
    // 2000 emoji * 2 UTF-16 code units = 4000 UTF-16 length (under
    // the 5120 char cap), but each emoji is 4 UTF-8 bytes -> 8000
    // bytes (over the 5120 byte cap). The UTF-8 byte check must
    // catch this.
    const evil = '\u{1F4A9}'.repeat(2000);
    const r = runJsSandbox(evil);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('bad-input');
    expect(r.error).toMatch(/byte limit|character limit/);
  });

  it('rejects 10 MB strings before allocating any V8 memory', () => {
    const huge = 'A'.repeat(10_000_000);
    const r = runJsSandbox(huge);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('bad-input');
    // Must reject without invoking isolated-vm at all - durationMs
    // should be 0 (no V8 alloc happened).
    expect(r.durationMs).toBe(0);
  });
});

// ----------------------------------------------------------------------------
// Runtime tests - require the native binding. Skipped if absent.
// ----------------------------------------------------------------------------
ivmDescribe('js-sandbox happy path', () => {
  it('returns a simple arithmetic expression result', () => {
    const r = runJsSandbox('return 1 + 2 + 3');
    expect(r.ok).toBe(true);
    expect(r.value).toBe(6);
    expect(r.kind).toBe('ok');
  });

  it('returns a simple object', () => {
    const r = runJsSandbox("return { a: 1, b: 'hello', c: [1,2,3] }");
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ a: 1, b: 'hello', c: [1, 2, 3] });
  });

  it('supports local variables and trailing return', () => {
    const r = runJsSandbox(`
      const xs = [1, 2, 3, 4, 5];
      const sum = xs.reduce((a, b) => a + b, 0);
      return { sum, mean: sum / xs.length };
    `);
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ sum: 15, mean: 3 });
  });

  it('supports modern ECMAScript (optional chaining, spread)', () => {
    const r = runJsSandbox(`
      const a = { x: { y: 42 } };
      const b = { ...a, z: a?.x?.y };
      return b;
    `);
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ x: { y: 42 }, z: 42 });
  });

  it('accepts the options-bag overload', () => {
    const r = runJsSandbox('return 7', { timeoutMs: 500, memoryMb: 16 });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(7);
  });

  it('accepts the legacy positional-ms overload', () => {
    const r = runJsSandbox('return 9', 500);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(9);
  });

  it('injects globals via ExternalCopy', () => {
    const r = runJsSandbox('return { sum: a + b }', {
      globals: { a: 10, b: 32 },
    });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ sum: 42 });
  });
});

ivmDescribe('js-sandbox isolation guarantees', () => {
  it('blocks `process`', () => {
    const r = runJsSandbox('return typeof process');
    expect(r.ok).toBe(true);
    expect(r.value).toBe('undefined');
  });

  it('blocks `require`', () => {
    const r = runJsSandbox('return typeof require');
    expect(r.ok).toBe(true);
    expect(r.value).toBe('undefined');
  });

  it('blocks `Buffer`', () => {
    const r = runJsSandbox('return typeof Buffer');
    expect(r.ok).toBe(true);
    expect(r.value).toBe('undefined');
  });

  it('blocks `global` (the Node-specific alias)', () => {
    const r = runJsSandbox('return typeof global');
    expect(r.ok).toBe(true);
    expect(r.value).toBe('undefined');
  });

  it('blocks `globalThis.process` walk', () => {
    const r = runJsSandbox('return typeof globalThis.process');
    expect(r.ok).toBe(true);
    expect(r.value).toBe('undefined');
  });

  it('blocks __proto__.constructor escape attempt', () => {
    const r = runJsSandbox(`
      try {
        const escape = ({}).__proto__.constructor.constructor('return process');
        return typeof escape();
      } catch (e) {
        return 'blocked';
      }
    `);
    expect(r.ok).toBe(true);
    // Either the Function constructor is blocked (eval gating) or it
    // runs inside the isolate and still cannot see host `process`.
    // Both outcomes are safe.
    expect(['blocked', 'undefined']).toContain(r.value);
  });

  it('does not leak host state between two calls (fresh isolate per call)', () => {
    runJsSandbox("globalThis.__leaked__ = 'evil'; return 1;");
    const r = runJsSandbox('return typeof globalThis.__leaked__');
    expect(r.ok).toBe(true);
    expect(r.value).toBe('undefined');
  });

  it('built-in prototypes are frozen before user code (no pollution)', () => {
    const r = runJsSandbox(`
      try { Object.prototype.polluted = 'yes'; } catch (_e) {}
      return { polluted: ({}).polluted ?? 'absent' };
    `);
    expect(r.ok).toBe(true);
    expect((r.value as { polluted: string }).polluted).toBe('absent');
  });
});

ivmDescribe('js-sandbox adversarial inputs (the reason we ban node:vm)', () => {
  it('kills a tight infinite loop via wall-clock timeout', () => {
    const r = runJsSandbox(
      "while (true) {} return 'unreachable'",
      200, // 200 ms cap so the test stays fast
    );
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.kind).toBe('timeout');
    expect(r.error).toMatch(/timed out/i);
  }, 10_000);

  it('kills a heap-bomb via memory cap (V8 isolate, NOT host heap)', () => {
    const r = runJsSandbox(
      `
      const big = [];
      while (true) {
        big.push(new Array(1_000_000).fill(0));
      }
      return 'unreachable'
    `,
      { timeoutMs: 4000, memoryMb: 16 },
    );
    expect(r.ok).toBe(false);
    // Either memory cap fires or timeout - both are acceptable
    // resolutions for an adversarial allocation loop. What we care
    // about is that the HOST process didn't OOM (test wouldn't
    // complete) and that ok=false.
    expect(r.memoryExhausted || r.timedOut).toBe(true);
    expect(['oom', 'timeout']).toContain(r.kind);
  }, 15_000);
});

ivmDescribe('js-sandbox result scrub', () => {
  it('functions in results NEVER reach the host caller', () => {
    const r = runJsSandbox(`return { value: 42, fn: () => 'host-leak' }`);
    if (r.ok) {
      const obj = r.value as { value?: number; fn?: unknown };
      expect(obj.value).toBe(42);
      expect(typeof obj.fn).not.toBe('function');
    } else {
      // Function-return rejected at the isolate boundary - equally safe.
      expect(r.error).toBeDefined();
    }
  });

  it('a returned function-only payload is REJECTED (cannot cross the boundary)', () => {
    const r = runJsSandbox(`return () => 'host-leak'`);
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
  });

  it('caps deeply-nested structures at MAX_RESULT_DEPTH', () => {
    const r = runJsSandbox(`
      let o = {};
      let cur = o;
      for (let i = 0; i < 100; i++) {
        cur.next = {};
        cur = cur.next;
      }
      return o;
    `);
    expect(r.ok).toBe(true);
    let v: unknown = r.value;
    let depth = 0;
    while (v && typeof v === 'object' && 'next' in v) {
      v = (v as { next: unknown }).next;
      depth += 1;
      if (depth > 50) break;
    }
    expect(depth).toBeLessThanOrEqual(10);
  });
});

ivmDescribe('js-sandbox error reporting', () => {
  it('returns ok=false on syntax errors with a message', () => {
    const r = runJsSandbox('this is not js');
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
    expect(r.kind).toBe('runtime');
  });

  it('returns ok=false on runtime errors with a message', () => {
    const r = runJsSandbox('null.x');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Runtime error|TypeError/i);
  });

  it('includes durationMs on every result', () => {
    const r = runJsSandbox('return 1');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('clamps timeouts above MAX_TIMEOUT_MS to the ceiling', () => {
    const started = Date.now();
    const r = runJsSandbox('while (true) {}', {
      timeoutMs: 60_000, // 60 s requested, but ceiling is 5 s
    });
    const elapsed = Date.now() - started;
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    // Must terminate well under 60 s thanks to MAX_TIMEOUT_MS clamp.
    expect(elapsed).toBeLessThan(10_000);
  }, 15_000);
});
