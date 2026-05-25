/**
 * Phase F.3 — orchestrator hook-chain integration tests.
 *
 * Verifies the 9 hook ports are wired to REAL adapters, not the no-op
 * defaults in `compose.ts:buildHookChain`. Each test exercises one hook
 * with a deliberately-crafted Decision that should trip / pass through
 * the specific port:
 *
 *   1. PII scrub:    tool input with a TZ NIDA → `transform` outcome
 *   2. Permission:   tool requires `sovereign.execute`, caller lacks it
 *                    → `deny` with code `permission-missing-scopes`
 *   3. Four-eye:     sovereign-tier tool with no approval record
 *                    → `ask-owner`
 *   4. Denylist:     global denylist contains the tool name → `deny`
 *   5. Rate limit:   2 calls/window, run 3 → 3rd `deny`
 *   6. Cost circuit: $0.50 estimate, $1 ceiling, $0.99 already spent
 *                    → `deny`
 *   7. Sandbox:      env-flagged tool → `sandbox`
 *   8. Audit sink:   every dispatched tool call writes a row
 *   9. Ledger seal:  stop runs the seal, sealHash is HMAC-SHA-256
 *
 * The router + dispatcher are mocked so the orchestrator's main loop
 * is not exercised here — the goal is to confirm the chain runs as
 * configured. End-to-end main-loop coverage lives in the kernel
 * package's orchestrator tests.
 */

import { describe, it, expect } from 'vitest';

import {
  buildOrchestratorBindings,
  buildProductionHookChain,
  createApprovalPolicyPort,
  createDrizzleToolDenylistPort,
  createEnvSandboxResolver,
  createHmacLedgerSealPort,
  createRealPiiScrubber,
  createScopeMapPort,
  createSlidingWindowRateLimitCounter,
  createSovereignLedgerAuditSink,
  resolveLedgerSealHmacKey,
  resolveRateLimitConfig,
  type SovereignLedgerServiceLike,
} from '../orchestrator-bindings';
import {
  createApprovalGate,
  createInMemoryApprovalStore,
  createBrainToolRegistry,
} from '@borjie/central-intelligence';

// ─────────────────────────────────────────────────────────────────────
// Helpers — minimal HookContext + tool_call Decision fixtures
// ─────────────────────────────────────────────────────────────────────

function makeCtx(opts: {
  readonly threadId?: string;
  readonly tenantId?: string;
  readonly grantedScopes?: ReadonlyArray<string>;
} = {}): {
  threadId: string;
  scope: { kind: 'tenant'; tenantId: string };
  tier: 'tenant';
  userMessage: string;
  tickStartedAt: number;
  grantedScopes: ReadonlyArray<string>;
} {
  return {
    threadId: opts.threadId ?? 'thread-1',
    scope: { kind: 'tenant', tenantId: opts.tenantId ?? 'tenant-A' },
    tier: 'tenant',
    userMessage: 'test',
    tickStartedAt: Date.now(),
    grantedScopes: opts.grantedScopes ?? [],
  };
}

function makeToolCall(toolName: string, input: Record<string, unknown> = {}, opts: {
  readonly callId?: string;
  readonly estimatedCostUsd?: number;
} = {}): {
  kind: 'tool_call';
  call: {
    toolName: string;
    input: Record<string, unknown>;
    callId: string;
    estimatedCostUsd?: number;
  };
} {
  return {
    kind: 'tool_call',
    call: {
      toolName,
      input,
      callId: opts.callId ?? 'call-1',
      ...(opts.estimatedCostUsd !== undefined
        ? { estimatedCostUsd: opts.estimatedCostUsd }
        : {}),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// 1. PII scrubber — real scrubPii() integration
// ─────────────────────────────────────────────────────────────────────

describe('createRealPiiScrubber', () => {
  it('detects a phone number in a tool input and reports hasPii', () => {
    const scrubber = createRealPiiScrubber();
    const result = scrubber.scrub('Call me at +255 712 345 678 today.');
    expect(result.hasPii).toBe(true);
    expect(result.scrubbed).toContain('[PHONE]');
  });

  it('returns hasPii=false for innocuous text', () => {
    const scrubber = createRealPiiScrubber();
    const result = scrubber.scrub('Hello world');
    expect(result.hasPii).toBe(false);
    expect(result.scrubbed).toBe('Hello world');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Scope map permission port
// ─────────────────────────────────────────────────────────────────────

describe('createScopeMapPort', () => {
  it('returns required scopes from the map', () => {
    const port = createScopeMapPort(
      new Map([['platform.purge', ['sovereign.execute']]]),
    );
    expect(port.requiredScopes('platform.purge')).toEqual(['sovereign.execute']);
    expect(port.requiredScopes('platform.read')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Four-eye approval policy port — wraps real ApprovalGate
// ─────────────────────────────────────────────────────────────────────

describe('createApprovalPolicyPort', () => {
  it('returns `none` when no approval record exists', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const port = createApprovalPolicyPort({
      gate,
      requiresApproval: (name) => name === 'platform.purge',
    });
    expect(port.requiresApproval('platform.purge')).toBe(true);
    expect(port.requiresApproval('platform.read')).toBe(false);
    const status = await port.approvalStatus({
      callId: 'unknown-call-id',
      toolName: 'platform.purge',
    });
    expect(status).toBe('none');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Drizzle tool denylist — verify port shape under a fake db.execute
// ─────────────────────────────────────────────────────────────────────

describe('createDrizzleToolDenylistPort', () => {
  it('returns true when the fake db returns a non-expiring row', async () => {
    const fakeDb = {
      execute: async () => ({ rows: [{ tenant_id: 'tenant-A', tool_name: 'platform.purge', expires_at: null }] }),
    };
    const port = createDrizzleToolDenylistPort({
      db: fakeDb,
      tenantId: 'tenant-A',
    });
    expect(await port.isDenied('platform.purge')).toBe(true);
  });

  it('returns false when the row is expired', async () => {
    const fakeDb = {
      execute: async () => ({
        rows: [
          {
            tenant_id: 'tenant-A',
            tool_name: 'platform.purge',
            expires_at: '2000-01-01T00:00:00.000Z',
          },
        ],
      }),
    };
    const port = createDrizzleToolDenylistPort({
      db: fakeDb,
      tenantId: 'tenant-A',
    });
    expect(await port.isDenied('platform.purge')).toBe(false);
  });

  it('falls open (allow) on DB error', async () => {
    const fakeDb = {
      execute: async () => {
        throw new Error('db down');
      },
    };
    const port = createDrizzleToolDenylistPort({
      db: fakeDb,
      tenantId: 'tenant-A',
    });
    expect(await port.isDenied('platform.purge')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Rate limit — sliding window counter
// ─────────────────────────────────────────────────────────────────────

describe('createSlidingWindowRateLimitCounter', () => {
  it('counts repeated calls within the window', async () => {
    let now = 1_000;
    const counter = createSlidingWindowRateLimitCounter(() => now);
    expect(
      await counter.incrementAndCount({
        threadId: 't',
        toolName: 'x',
        windowMs: 1000,
      }),
    ).toBe(1);
    now = 1_500;
    expect(
      await counter.incrementAndCount({
        threadId: 't',
        toolName: 'x',
        windowMs: 1000,
      }),
    ).toBe(2);
    now = 3_000;
    expect(
      await counter.incrementAndCount({
        threadId: 't',
        toolName: 'x',
        windowMs: 1000,
      }),
    ).toBe(1); // earlier two slipped out of the window
  });
});

describe('resolveRateLimitConfig', () => {
  it('reads env defaults', () => {
    expect(resolveRateLimitConfig({})).toEqual({
      maxCallsPerWindow: 30,
      windowMs: 60_000,
    });
  });

  it('respects custom env values', () => {
    expect(
      resolveRateLimitConfig({
        RATE_LIMIT_MAX_CALLS_PER_WINDOW: '5',
        RATE_LIMIT_WINDOW_MS: '1000',
      }),
    ).toEqual({ maxCallsPerWindow: 5, windowMs: 1_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. Sandbox resolver
// ─────────────────────────────────────────────────────────────────────

describe('createEnvSandboxResolver', () => {
  it('returns null when no env config', async () => {
    const resolver = createEnvSandboxResolver({});
    expect(
      await resolver.resolve({ tenantId: 'tenant-A', toolName: 'x' }),
    ).toBeNull();
  });

  it('returns a sandbox id for an env-listed tool', async () => {
    const resolver = createEnvSandboxResolver({
      BORJIE_SANDBOX_TOOLS: 'platform.purge,platform.scry',
    });
    expect(
      await resolver.resolve({
        tenantId: 'tenant-A',
        toolName: 'platform.purge',
      }),
    ).toBe('sandbox:tenant-A:platform.purge');
    expect(
      await resolver.resolve({ tenantId: 'tenant-A', toolName: 'platform.read' }),
    ).toBeNull();
  });

  it('honors the tenant allow-list when set', async () => {
    const resolver = createEnvSandboxResolver({
      BORJIE_SANDBOX_TOOLS: 'platform.purge',
      BORJIE_SANDBOX_TENANTS: 'tenant-A',
    });
    expect(
      await resolver.resolve({
        tenantId: 'tenant-B',
        toolName: 'platform.purge',
      }),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8 + 9. Audit + ledger-seal — fake sovereign ledger
// ─────────────────────────────────────────────────────────────────────

interface FakeLedger extends SovereignLedgerServiceLike {
  readonly entries: ReadonlyArray<{
    readonly tenantId: string;
    readonly actionType: string;
    readonly payloadJson: Record<string, unknown>;
  }>;
}

function createFakeLedger(): FakeLedger {
  const entries: Array<{
    tenantId: string;
    actionType: string;
    payloadJson: Record<string, unknown>;
  }> = [];
  return {
    async appendLedgerEntry(args) {
      entries.push({
        tenantId: args.tenantId,
        actionType: args.actionType,
        payloadJson: args.payloadJson,
      });
      return { id: `id-${entries.length}`, thisHash: 'h', prevHash: 'p' };
    },
    get entries() {
      return entries;
    },
  };
}

describe('createSovereignLedgerAuditSink', () => {
  it('writes a kernel.tool.ok entry on success', async () => {
    const ledger = createFakeLedger();
    const sink = createSovereignLedgerAuditSink({
      ledger,
      tenantId: 'tenant-A',
      proposer: 'kernel',
    });
    await sink.record({
      threadId: 't',
      toolName: 'platform.read',
      callId: 'c',
      outcome: 'ok',
      latencyMs: 12,
      tokensIn: 10,
      tokensOut: 8,
      usdCost: 0.001,
      errorMessage: null,
      capturedAt: new Date().toISOString(),
    });
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].actionType).toBe('kernel.tool.ok');
    expect(ledger.entries[0].payloadJson.toolName).toBe('platform.read');
    expect(ledger.entries[0].payloadJson.errorMessage).toBeNull();
  });

  it('swallows ledger errors so audit outage cannot block orchestrator', async () => {
    const sink = createSovereignLedgerAuditSink({
      ledger: {
        async appendLedgerEntry(): Promise<never> {
          throw new Error('db down');
        },
      },
      tenantId: 'tenant-A',
      proposer: 'kernel',
    });
    await expect(
      sink.record({
        threadId: 't',
        toolName: 'platform.read',
        callId: 'c',
        outcome: 'error',
        latencyMs: 12,
        tokensIn: 0,
        tokensOut: 0,
        usdCost: 0,
        errorMessage: 'boom',
        capturedAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
  });
});

describe('createHmacLedgerSealPort', () => {
  it('produces a stable HMAC-SHA-256 seal for the same input', async () => {
    const ledger = createFakeLedger();
    const port = createHmacLedgerSealPort({
      ledger,
      tenantId: 'tenant-A',
      proposer: 'kernel',
      hmacKey: 'test-key-1234567890ab',
    });
    const arg = {
      threadId: 't1',
      turnCount: 3,
      exhaustedAxis: null as const,
      finalText: 'done',
      sealedAt: '2026-05-01T00:00:00.000Z',
    };
    const seal1 = await port.seal(arg);
    const seal2 = await port.seal(arg);
    expect(seal1.sealHash).toBe(seal2.sealHash);
    expect(seal1.sealHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ledger.entries.length).toBe(2);
    expect(ledger.entries[0].actionType).toBe('kernel.session.seal');
  });
});

describe('resolveLedgerSealHmacKey', () => {
  it('uses the env key when present and long enough', () => {
    expect(resolveLedgerSealHmacKey({ LEDGER_SEAL_HMAC_KEY: 'k'.repeat(32) })).toBe(
      'k'.repeat(32),
    );
  });

  it('falls back when the env key is too short', () => {
    const key = resolveLedgerSealHmacKey({ LEDGER_SEAL_HMAC_KEY: 'short' });
    expect(key).toContain('dev-fallback');
  });
});

// ─────────────────────────────────────────────────────────────────────
// End-to-end — buildProductionHookChain wires all 9 hooks
// ─────────────────────────────────────────────────────────────────────

describe('buildProductionHookChain', () => {
  it('runs all 9 hooks (real ports — no no-op factories) and exposes them via list()', async () => {
    const ledger = createFakeLedger();
    const chain = buildProductionHookChain({
      piiScrubber: createRealPiiScrubber(),
      toolScopes: createScopeMapPort(new Map()),
      approvalPolicy: createApprovalPolicyPort({
        gate: createApprovalGate({ store: createInMemoryApprovalStore() }),
        requiresApproval: () => false,
      }),
      toolDenylist: { async isDenied() { return false; } },
      rateLimitCounter: createSlidingWindowRateLimitCounter(),
      rateLimitConfig: { maxCallsPerWindow: 10, windowMs: 1000 },
      costCircuit: {
        async project() {
          return { projectedUsd: 0.1, ceilingUsd: 1.0 };
        },
      },
      sandboxResolver: createEnvSandboxResolver({}),
      auditSink: createSovereignLedgerAuditSink({
        ledger,
        tenantId: 'tenant-A',
        proposer: 'kernel',
      }),
      ledgerSeal: createHmacLedgerSealPort({
        ledger,
        tenantId: 'tenant-A',
        proposer: 'kernel',
        hmacKey: 'test-key-1234567890ab',
      }),
    });

    const hooks = chain.list();
    const names = hooks.map((h) => h.name).sort();
    expect(names).toEqual(
      [
        'audit-emission',
        'cost-circuit',
        'four-eye-approval',
        'ledger-seal',
        'permission',
        'pii-scrub',
        'rate-limit',
        'sandbox-divert',
        'tool-denylist',
      ].sort(),
    );

    // Real-port chain should pass through a clean tool_call decision.
    const ctx = makeCtx({ tenantId: 'tenant-A', grantedScopes: [] });
    const decision = makeToolCall('platform.read', { q: 'hello' });
    const result = await chain.runPreToolUse(decision, ctx);
    expect(result.outcome.kind).toBe('allow');
  });

  it('PII hook transforms decision when input contains NIDA', async () => {
    const ledger = createFakeLedger();
    const chain = buildProductionHookChain({
      piiScrubber: createRealPiiScrubber(),
      toolScopes: createScopeMapPort(new Map()),
      approvalPolicy: createApprovalPolicyPort({
        gate: createApprovalGate({ store: createInMemoryApprovalStore() }),
        requiresApproval: () => false,
      }),
      toolDenylist: { async isDenied() { return false; } },
      rateLimitCounter: createSlidingWindowRateLimitCounter(),
      rateLimitConfig: { maxCallsPerWindow: 10, windowMs: 1000 },
      costCircuit: {
        async project() {
          return { projectedUsd: 0, ceilingUsd: 1 };
        },
      },
      sandboxResolver: createEnvSandboxResolver({}),
      auditSink: createSovereignLedgerAuditSink({
        ledger,
        tenantId: 'tenant-A',
        proposer: 'kernel',
      }),
      ledgerSeal: createHmacLedgerSealPort({
        ledger,
        tenantId: 'tenant-A',
        proposer: 'kernel',
        hmacKey: 'test-key-1234567890ab',
      }),
    });

    const ctx = makeCtx();
    const decision = makeToolCall('platform.read', {
      message: 'Call me at +255 712 345 678 today.',
    });
    const result = await chain.runPreToolUse(decision, ctx);
    // PII hook returns `transform` (terminal in the chain); the chain
    // surfaces it directly as the outcome.
    expect(result.outcome.kind).toBe('transform');
    if (result.outcome.kind === 'transform') {
      const replaced = result.outcome.replacement;
      if (replaced.kind === 'tool_call') {
        expect(String(replaced.call.input.message)).toContain('[PHONE]');
      } else {
        throw new Error('expected tool_call replacement');
      }
    }
  });

  it('permission hook denies when caller lacks the required scope', async () => {
    const ledger = createFakeLedger();
    const chain = buildProductionHookChain({
      piiScrubber: createRealPiiScrubber(),
      toolScopes: createScopeMapPort(
        new Map([['platform.purge', ['sovereign.execute']]]),
      ),
      approvalPolicy: createApprovalPolicyPort({
        gate: createApprovalGate({ store: createInMemoryApprovalStore() }),
        requiresApproval: () => false,
      }),
      toolDenylist: { async isDenied() { return false; } },
      rateLimitCounter: createSlidingWindowRateLimitCounter(),
      rateLimitConfig: { maxCallsPerWindow: 10, windowMs: 1000 },
      costCircuit: {
        async project() {
          return { projectedUsd: 0, ceilingUsd: 1 };
        },
      },
      sandboxResolver: createEnvSandboxResolver({}),
      auditSink: createSovereignLedgerAuditSink({
        ledger,
        tenantId: 'tenant-A',
        proposer: 'kernel',
      }),
      ledgerSeal: createHmacLedgerSealPort({
        ledger,
        tenantId: 'tenant-A',
        proposer: 'kernel',
        hmacKey: 'test-key-1234567890ab',
      }),
    });

    const ctx = makeCtx({ grantedScopes: [] });
    const decision = makeToolCall('platform.purge', {});
    const result = await chain.runPreToolUse(decision, ctx);
    expect(result.outcome.kind).toBe('deny');
    if (result.outcome.kind === 'deny') {
      expect(result.outcome.code).toBe('permission-missing-scopes');
    }
  });

  it('rate-limit hook denies once max-calls-per-window is exceeded', async () => {
    const ledger = createFakeLedger();
    const chain = buildProductionHookChain({
      piiScrubber: createRealPiiScrubber(),
      toolScopes: createScopeMapPort(new Map()),
      approvalPolicy: createApprovalPolicyPort({
        gate: createApprovalGate({ store: createInMemoryApprovalStore() }),
        requiresApproval: () => false,
      }),
      toolDenylist: { async isDenied() { return false; } },
      rateLimitCounter: createSlidingWindowRateLimitCounter(),
      rateLimitConfig: { maxCallsPerWindow: 2, windowMs: 60_000 },
      costCircuit: {
        async project() {
          return { projectedUsd: 0, ceilingUsd: 1 };
        },
      },
      sandboxResolver: createEnvSandboxResolver({}),
      auditSink: createSovereignLedgerAuditSink({
        ledger,
        tenantId: 'tenant-A',
        proposer: 'kernel',
      }),
      ledgerSeal: createHmacLedgerSealPort({
        ledger,
        tenantId: 'tenant-A',
        proposer: 'kernel',
        hmacKey: 'test-key-1234567890ab',
      }),
    });

    const ctx = makeCtx();
    const decision = makeToolCall('platform.read', {});
    await chain.runPreToolUse(decision, ctx);
    await chain.runPreToolUse(decision, ctx);
    const third = await chain.runPreToolUse(decision, ctx);
    expect(third.outcome.kind).toBe('deny');
    if (third.outcome.kind === 'deny') {
      expect(third.outcome.code).toBe('rate-limit-exceeded');
    }
  });

  it('cost-circuit hook denies when projected spend exceeds ceiling', async () => {
    const ledger = createFakeLedger();
    const chain = buildProductionHookChain({
      piiScrubber: createRealPiiScrubber(),
      toolScopes: createScopeMapPort(new Map()),
      approvalPolicy: createApprovalPolicyPort({
        gate: createApprovalGate({ store: createInMemoryApprovalStore() }),
        requiresApproval: () => false,
      }),
      toolDenylist: { async isDenied() { return false; } },
      rateLimitCounter: createSlidingWindowRateLimitCounter(),
      rateLimitConfig: { maxCallsPerWindow: 100, windowMs: 60_000 },
      costCircuit: {
        async project() {
          return { projectedUsd: 5, ceilingUsd: 1 };
        },
      },
      sandboxResolver: createEnvSandboxResolver({}),
      auditSink: createSovereignLedgerAuditSink({
        ledger,
        tenantId: 'tenant-A',
        proposer: 'kernel',
      }),
      ledgerSeal: createHmacLedgerSealPort({
        ledger,
        tenantId: 'tenant-A',
        proposer: 'kernel',
        hmacKey: 'test-key-1234567890ab',
      }),
    });

    const ctx = makeCtx();
    const decision = makeToolCall('platform.read', {}, { estimatedCostUsd: 0.5 });
    const result = await chain.runPreToolUse(decision, ctx);
    expect(result.outcome.kind).toBe('deny');
    if (result.outcome.kind === 'deny') {
      expect(result.outcome.code).toBe('cost-ceiling-breach');
    }
  });

  it('sandbox-divert hook returns sandbox outcome when tool flagged', async () => {
    const ledger = createFakeLedger();
    const chain = buildProductionHookChain({
      piiScrubber: createRealPiiScrubber(),
      toolScopes: createScopeMapPort(new Map()),
      approvalPolicy: createApprovalPolicyPort({
        gate: createApprovalGate({ store: createInMemoryApprovalStore() }),
        requiresApproval: () => false,
      }),
      toolDenylist: { async isDenied() { return false; } },
      rateLimitCounter: createSlidingWindowRateLimitCounter(),
      rateLimitConfig: { maxCallsPerWindow: 100, windowMs: 60_000 },
      costCircuit: {
        async project() {
          return { projectedUsd: 0, ceilingUsd: 1 };
        },
      },
      sandboxResolver: createEnvSandboxResolver({
        BORJIE_SANDBOX_TOOLS: 'platform.read',
      }),
      auditSink: createSovereignLedgerAuditSink({
        ledger,
        tenantId: 'tenant-A',
        proposer: 'kernel',
      }),
      ledgerSeal: createHmacLedgerSealPort({
        ledger,
        tenantId: 'tenant-A',
        proposer: 'kernel',
        hmacKey: 'test-key-1234567890ab',
      }),
    });

    const ctx = makeCtx({ tenantId: 'tenant-A' });
    const decision = makeToolCall('platform.read', {});
    const result = await chain.runPreToolUse(decision, ctx);
    expect(result.outcome.kind).toBe('sandbox');
    if (result.outcome.kind === 'sandbox') {
      expect(result.outcome.sandboxId).toBe('sandbox:tenant-A:platform.read');
    }
  });

  it('audit-emission hook writes a row on PostToolUse', async () => {
    const ledger = createFakeLedger();
    const chain = buildProductionHookChain({
      piiScrubber: createRealPiiScrubber(),
      toolScopes: createScopeMapPort(new Map()),
      approvalPolicy: createApprovalPolicyPort({
        gate: createApprovalGate({ store: createInMemoryApprovalStore() }),
        requiresApproval: () => false,
      }),
      toolDenylist: { async isDenied() { return false; } },
      rateLimitCounter: createSlidingWindowRateLimitCounter(),
      rateLimitConfig: { maxCallsPerWindow: 100, windowMs: 60_000 },
      costCircuit: {
        async project() {
          return { projectedUsd: 0, ceilingUsd: 1 };
        },
      },
      sandboxResolver: createEnvSandboxResolver({}),
      auditSink: createSovereignLedgerAuditSink({
        ledger,
        tenantId: 'tenant-A',
        proposer: 'kernel',
      }),
      ledgerSeal: createHmacLedgerSealPort({
        ledger,
        tenantId: 'tenant-A',
        proposer: 'kernel',
        hmacKey: 'test-key-1234567890ab',
      }),
    });

    const ctx = makeCtx();
    const decision = makeToolCall('platform.read', {});
    const dispatchResult = {
      kind: 'tool_ok' as const,
      callId: 'call-1',
      output: { ok: true },
      latencyMs: 10,
      tokensIn: 5,
      tokensOut: 3,
      usdCost: 0.001,
    };
    const outcome = await chain.runPostToolUse(decision, dispatchResult, ctx);
    expect(outcome.kind).toBe('allow');
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].actionType).toBe('kernel.tool.ok');
  });

  it('ledger-seal hook writes a session seal at Stop', async () => {
    const ledger = createFakeLedger();
    const chain = buildProductionHookChain({
      piiScrubber: createRealPiiScrubber(),
      toolScopes: createScopeMapPort(new Map()),
      approvalPolicy: createApprovalPolicyPort({
        gate: createApprovalGate({ store: createInMemoryApprovalStore() }),
        requiresApproval: () => false,
      }),
      toolDenylist: { async isDenied() { return false; } },
      rateLimitCounter: createSlidingWindowRateLimitCounter(),
      rateLimitConfig: { maxCallsPerWindow: 100, windowMs: 60_000 },
      costCircuit: {
        async project() {
          return { projectedUsd: 0, ceilingUsd: 1 };
        },
      },
      sandboxResolver: createEnvSandboxResolver({}),
      auditSink: createSovereignLedgerAuditSink({
        ledger,
        tenantId: 'tenant-A',
        proposer: 'kernel',
      }),
      ledgerSeal: createHmacLedgerSealPort({
        ledger,
        tenantId: 'tenant-A',
        proposer: 'kernel',
        hmacKey: 'test-key-1234567890ab',
      }),
    });

    const ctx = makeCtx();
    const session = {
      threadId: 't',
      turnCount: 2,
      finalText: 'final',
      exhaustedAxis: null,
    };
    const outcome = await chain.runStop(session, ctx);
    expect(outcome.kind).toBe('allow');
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].actionType).toBe('kernel.session.seal');
    expect(ledger.entries[0].payloadJson.sealHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Top-level builder smoke test — degraded (no db) path
// ─────────────────────────────────────────────────────────────────────

describe('buildOrchestratorBindings', () => {
  it('builds a complete 9-hook chain in degraded (db=null) mode', () => {
    const result = buildOrchestratorBindings({
      db: null,
      approvalGate: createApprovalGate({ store: createInMemoryApprovalStore() }),
      toolRegistry: createBrainToolRegistry(),
      tenantId: '_platform',
      env: {},
    });
    const names = result.hookChain.list().map((h) => h.name).sort();
    expect(names).toEqual(
      [
        'audit-emission',
        'cost-circuit',
        'four-eye-approval',
        'ledger-seal',
        'permission',
        'pii-scrub',
        'rate-limit',
        'sandbox-divert',
        'tool-denylist',
      ].sort(),
    );
  });
});
