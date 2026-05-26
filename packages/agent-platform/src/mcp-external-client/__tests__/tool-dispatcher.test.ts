/**
 * Tool dispatcher unit tests.
 *
 * Verifies the three invariants from spec §6:
 *   1. tier check runs before the remote call,
 *   2. audit link is emitted on success and on error,
 *   3. result-mapper-shaped envelope is returned.
 */
import { describe, expect, it } from 'vitest';
import {
  createToolDispatcher,
  type AuditChainSink,
  type ConnectionLookup,
  type InvokeAdapter,
  type MutationAuthority,
} from '../invocation/tool-dispatcher.js';
import type {
  McpAuditLink,
  McpCatalogEntry,
  McpToolInvocation,
} from '../types.js';
import { findCatalogEntry } from '../catalog/public-servers.js';

const slack = findCatalogEntry('slack') as McpCatalogEntry;

function buildDeps(overrides: {
  readonly assertAllowed?: MutationAuthority['assertAllowed'];
  readonly invoke?: InvokeAdapter['invoke'];
  readonly findByServer?: ConnectionLookup['findByServer'];
  readonly captured?: McpAuditLink[];
}) {
  const captured = overrides.captured ?? [];
  const auditSink: AuditChainSink = {
    append: async (link) => {
      captured.push(link);
    },
  };
  const mutationAuthority: MutationAuthority = {
    assertAllowed: overrides.assertAllowed ?? (async () => {}),
  };
  const connectionLookup: ConnectionLookup = {
    findByServer:
      overrides.findByServer ??
      (async () => ({ connectionId: 'conn-1', entry: slack })),
  };
  const invoker: InvokeAdapter = {
    invoke:
      overrides.invoke ??
      (async () =>
        Object.freeze({
          ok: true,
          content: Object.freeze([{ type: 'text', text: 'ok' }]),
        })),
  };
  return {
    deps: {
      mutationAuthority,
      auditSink,
      connectionLookup,
      invoker,
      now: () => 1_700_000_000_000,
    },
    captured,
  };
}

const invocation: McpToolInvocation = Object.freeze({
  tenantId: 'tenant-1',
  serverId: 'slack',
  toolName: 'send_message',
  input: { channel: 'C1', text: 'hi' },
  correlationId: 'corr-1',
});

describe('tool-dispatcher', () => {
  it('asserts the mutation tier before calling the remote', async () => {
    let asserted: { tier: number; toolName: string } | null = null;
    let invokedAfterAssert = false;
    const { deps } = buildDeps({
      assertAllowed: async ({ tier, toolName }) => {
        asserted = { tier, toolName };
      },
      invoke: async () => {
        if (asserted === null) throw new Error('invoked before assert');
        invokedAfterAssert = true;
        return Object.freeze({ ok: true, content: Object.freeze([]) });
      },
    });
    const dispatcher = createToolDispatcher(deps);
    await dispatcher.dispatch(invocation);
    expect(asserted).toEqual({ tier: slack.maxTier, toolName: 'send_message' });
    expect(invokedAfterAssert).toBe(true);
  });

  it('appends an ok audit link on successful invocation', async () => {
    const { deps, captured } = buildDeps({});
    const dispatcher = createToolDispatcher(deps);
    const result = await dispatcher.dispatch(invocation);
    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(1);
    const link = captured[0]!;
    expect(link.outcome).toBe('ok');
    expect(link.connectionId).toBe('conn-1');
    expect(link.tenantId).toBe('tenant-1');
    expect(link.toolName).toBe('send_message');
  });

  it('appends an error audit link when the invoker throws', async () => {
    const { deps, captured } = buildDeps({
      invoke: async () => {
        throw new Error('network down');
      },
    });
    const dispatcher = createToolDispatcher(deps);
    const result = await dispatcher.dispatch(invocation);
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe('network down');
    expect(captured).toHaveLength(1);
    expect(captured[0]!.outcome).toBe('error');
    expect(captured[0]!.errorMessage).toBe('network down');
  });

  it('throws when no connection exists', async () => {
    const { deps } = buildDeps({
      findByServer: async () => null,
    });
    const dispatcher = createToolDispatcher(deps);
    await expect(dispatcher.dispatch(invocation)).rejects.toThrow(
      /no connection/,
    );
  });

  it('propagates tier-override values when set', async () => {
    let observedTier = -1;
    const { deps } = buildDeps({
      assertAllowed: async ({ tier }) => {
        observedTier = tier;
      },
    });
    const overrides = new Map<string, 0 | 1 | 2>([
      ['slack:send_message', 2],
    ]);
    const dispatcher = createToolDispatcher({
      ...deps,
      tierOverrides: overrides,
    });
    await dispatcher.dispatch(invocation);
    expect(observedTier).toBe(2);
  });

  it('treats a non-ok invoker result as an error in the audit link', async () => {
    const { deps, captured } = buildDeps({
      invoke: async () =>
        Object.freeze({
          ok: false,
          content: Object.freeze([]),
          errorMessage: 'auth expired',
        }),
    });
    const dispatcher = createToolDispatcher(deps);
    await dispatcher.dispatch(invocation);
    expect(captured[0]!.outcome).toBe('error');
    expect(captured[0]!.errorMessage).toBe('auth expired');
  });

  it('swallows audit-sink failures so the result still reaches the kernel', async () => {
    const failingSink: AuditChainSink = {
      append: async () => {
        throw new Error('audit chain down');
      },
    };
    const dispatcher = createToolDispatcher({
      mutationAuthority: { assertAllowed: async () => {} },
      auditSink: failingSink,
      connectionLookup: {
        findByServer: async () => ({ connectionId: 'c', entry: slack }),
      },
      invoker: {
        invoke: async () =>
          Object.freeze({ ok: true, content: Object.freeze([]) }),
      },
    });
    const result = await dispatcher.dispatch(invocation);
    expect(result.ok).toBe(true);
  });
});
