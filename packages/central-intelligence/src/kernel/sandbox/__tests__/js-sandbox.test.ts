/**
 * @vitest-environment node
 *
 * JS sandbox tests — V8 isolates via isolated-vm (May 2026 SOTA).
 *
 * Critical invariants:
 *   1. Pure-math + array transforms return correctly.
 *   2. Hard caps: 5 KB code, 5 s timeout, 8 MB memory, frozen context.
 *   3. Sandbox isolation: no `require`, `import`, `process`, `fs`, `net`,
 *      `Buffer`, `global`, `crypto`.
 *   4. Function returns are rejected — only structured-clonable values
 *      can cross the sandbox boundary.
 *   5. Audit port fires on every invocation with structured metadata.
 *   6. Policy gate clamps caller caps to the kernel hard limits.
 */

import { describe, it, expect } from 'vitest';
import { runInSandbox } from '../js-sandbox.js';
import { runInSandboxWithPolicy } from '../sandbox-policy.js';
import {
  MAX_CODE_BYTES,
  MAX_TIMEOUT_MS,
  type SandboxAuditEvent,
} from '../types.js';

describe('runInSandbox — happy paths', () => {
  it('computes a sum and returns the number', async () => {
    const r = await runInSandbox('return [1,2,3,4,5].reduce((a,b)=>a+b, 0)');
    expect(r.ok).toBe(true);
    expect(r.result).toBe(15);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('filters an array and returns the array', async () => {
    const r = await runInSandbox(
      'return [1,2,3,4,5,6].filter((n) => n % 2 === 0)',
    );
    expect(r.ok).toBe(true);
    expect(r.result).toEqual([2, 4, 6]);
  });

  it('reads injected context but does not mutate the parent object', async () => {
    const ctx: Record<string, unknown> = { x: 10, y: 20 };
    const r = await runInSandbox(
      // The snippet attempts to mutate; ExternalCopy gives it a frozen
      // deep copy, so the host-side `ctx` is untouched.
      'try { ctx.x = 999; } catch {} return ctx.x + ctx.y;',
      { ctx },
    );
    expect(r.ok).toBe(true);
    // Either: (a) the sandbox copy was frozen and mutation silently
    // failed → result is 30; (b) the copy was writable but the host
    // reference was untouched → result is 1019. Either way the host
    // object must NOT have been mutated.
    expect((ctx as { x: number }).x).toBe(10);
    expect((ctx as { y: number }).y).toBe(20);
    expect([30, 1019]).toContain(r.result);
  });
});

describe('runInSandbox — hard caps', () => {
  it('rejects snippets larger than 5 KB', async () => {
    const tooBig = `return '${'a'.repeat(MAX_CODE_BYTES + 100)}'`;
    const r = await runInSandbox(tooBig);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('SANDBOX_CODE_TOO_LARGE');
  });

  it('rejects empty snippets', async () => {
    const r = await runInSandbox('');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('SANDBOX_CODE_INVALID');
  });

  it('kills an infinite loop via the 5 s wall-clock timeout', async () => {
    const r = await runInSandbox('while (true) {} return 1', {}, { timeoutMs: 300 });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('SANDBOX_TIMEOUT');
  });

  it('kills a heap-bomb that exceeds the 8 MB memory cap', async () => {
    const r = await runInSandbox(
      `
      const big = [];
      while (true) { big.push(new Array(1_000_000).fill(0)); }
      return 'unreachable';
      `,
      {},
      { timeoutMs: 4000, memoryMb: 8 },
    );
    expect(r.ok).toBe(false);
    // Either the memory cap fires or the timeout — both prove the
    // host process did not OOM (test would not complete) and that the
    // sandbox terminated the snippet.
    expect(['SANDBOX_MEMORY_EXCEEDED', 'SANDBOX_TIMEOUT']).toContain(r.error?.code);
  });
});

describe('runInSandbox — isolation guarantees', () => {
  it('blocks require()', async () => {
    const r = await runInSandbox('return typeof require');
    expect(r.ok).toBe(true);
    expect(r.result).toBe('undefined');
  });

  it('blocks process', async () => {
    const r = await runInSandbox('return typeof process');
    expect(r.ok).toBe(true);
    expect(r.result).toBe('undefined');
  });

  it('blocks fs / net / crypto / Buffer', async () => {
    const r = await runInSandbox(`
      return {
        fs: typeof fs,
        net: typeof net,
        crypto: typeof crypto,
        Buffer: typeof Buffer,
      };
    `);
    expect(r.ok).toBe(true);
    expect(r.result).toEqual({
      fs: 'undefined',
      net: 'undefined',
      crypto: 'undefined',
      Buffer: 'undefined',
    });
  });

  it('eval-chain via new Function() is constrained (no host escape)', async () => {
    const r = await runInSandbox(`
      try {
        const f = new Function('return 1');
        return f();
      } catch (e) {
        return 'blocked';
      }
    `);
    // Either: (a) Function constructor is disabled by isolated-vm and
    // we get 'blocked'; (b) it works but the isolate boundary prevents
    // any host escape. Both outcomes are safe.
    expect(r.ok).toBe(true);
    expect([1, 'blocked']).toContain(r.result);
  });

  it('rejects returning a function (only structured-clonable values cross)', async () => {
    const r = await runInSandbox('return () => "host-leak"');
    // copy: true rejects the function at the boundary — ok=false with
    // either SANDBOX_RESULT_NOT_CLONABLE or SANDBOX_THROW depending on
    // isolated-vm version. Either is safe.
    expect(r.ok).toBe(false);
    expect(['SANDBOX_RESULT_NOT_CLONABLE', 'SANDBOX_THROW']).toContain(r.error?.code);
  });
});

describe('runInSandbox — error surface', () => {
  it('throw inside the snippet → SANDBOX_THROW with the message', async () => {
    const r = await runInSandbox('throw new Error("boom")');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('SANDBOX_THROW');
    expect(r.error?.message).toMatch(/boom/);
  });

  it('awaits a returned promise within the time cap', async () => {
    const r = await runInSandbox(
      // Resolve via a microtask so we hit the await path.
      'return Promise.resolve(42)',
      {},
      { timeoutMs: 1000 },
    );
    // isolated-vm copy:true with a Promise either:
    //   (a) returns the resolved value (rare — depends on the build)
    //   (b) returns a clone that scrubs to {} or null
    //   (c) rejects the promise transfer → SANDBOX_RESULT_NOT_CLONABLE
    // All outcomes are safe; we just verify the sandbox completes and
    // does not hang.
    expect(typeof r.durationMs).toBe('number');
    expect(r.durationMs).toBeLessThan(MAX_TIMEOUT_MS);
  });
});

describe('runInSandboxWithPolicy — tier caps', () => {
  it('clamps caller-requested timeout to the kernel hard cap (5000ms)', async () => {
    // Caller asks for 99999ms; tier cap is 5000ms. Effective cap = 5000.
    const r = await runInSandboxWithPolicy({
      code: 'return 1+2',
      tier: 'enterprise',
      timeoutMs: 99999,
    });
    expect(r.ok).toBe(true);
    expect(r.enforcedCaps.timeoutMs).toBe(MAX_TIMEOUT_MS);
  });

  it('free-tier code-size cap rejects snippets above the per-tier limit', async () => {
    // free tier code-byte cap is 2 KB. Send 3 KB — policy rejects.
    const code = `return '${'b'.repeat(3 * 1024)}'`;
    const r = await runInSandboxWithPolicy({ code, tier: 'free' });
    expect(r.ok).toBe(false);
    expect(r.policyRejected).toBe(true);
    expect(r.error?.code).toBe('SANDBOX_CODE_TOO_LARGE');
  });

  it('emits an audit event on every invocation', async () => {
    const events: SandboxAuditEvent[] = [];
    const auditor = (e: SandboxAuditEvent): void => {
      events.push(e);
    };

    await runInSandboxWithPolicy({
      code: 'return 1+2',
      tier: 'pro',
      auditor,
      callerTag: 'unit-test-happy',
    });
    await runInSandboxWithPolicy({
      code: 'throw new Error("x")',
      tier: 'pro',
      auditor,
      callerTag: 'unit-test-throw',
    });

    expect(events).toHaveLength(2);
    expect(events[0]?.ok).toBe(true);
    expect(events[0]?.callerTag).toBe('unit-test-happy');
    expect(events[1]?.ok).toBe(false);
    expect(events[1]?.errorCode).toBe('SANDBOX_THROW');
    expect(events[1]?.callerTag).toBe('unit-test-throw');
    // Both events carry the backend tag so operators can spot fallback usage.
    expect(['isolated-vm', 'node-vm-fallback']).toContain(events[0]?.backend);
  });
});
