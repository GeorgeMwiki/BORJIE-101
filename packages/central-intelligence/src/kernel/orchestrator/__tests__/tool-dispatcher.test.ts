/**
 * Item-5 — tool dispatcher adapter tests.
 *
 * Proves the dispatcher actuates each Decision variant against the
 * kernel's real BrainToolRegistry and never throws out of `dispatch`.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createToolDispatcher } from '../tool-dispatcher.js';
import { createBrainToolRegistry } from '../../tool-spec.js';
import type { Decision } from '../decision.js';
import type { HookContext } from '../hook-chain.js';
import type { ScopeContext } from '../../../types.js';

const SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_1',
  actorUserId: 'u_1',
  roles: ['owner'],
  personaId: 'p_1',
};

const CTX: HookContext = {
  threadId: 'th_1',
  scope: SCOPE,
  tier: 'tenant',
  userMessage: 'hi',
  tickStartedAt: 0,
};

function registryWithEchoTool(): ReturnType<typeof createBrainToolRegistry> {
  const registry = createBrainToolRegistry();
  registry.register({
    name: 'echo',
    description: 'echoes its input',
    schemaIn: z.object({ value: z.number() }),
    schemaOut: z.object({ doubled: z.number() }),
    tier: 'read',
    requiresApproval: false,
    executor: async (input) => ({ doubled: input.value * 2 }),
  });
  return registry;
}

describe('createToolDispatcher', () => {
  it('runs a registry tool and maps ok → tool_ok', async () => {
    const dispatcher = createToolDispatcher({ registry: registryWithEchoTool() });
    const decision: Decision = {
      kind: 'tool_call',
      call: { toolName: 'echo', input: { value: 21 }, callId: 'c1' },
    };
    const result = await dispatcher.dispatch(decision, CTX);
    expect(result.kind).toBe('tool_ok');
    if (result.kind === 'tool_ok') {
      expect(result.callId).toBe('c1');
      expect(result.output).toEqual({ doubled: 42 });
    }
  });

  it('maps a missing tool to tool_error', async () => {
    const dispatcher = createToolDispatcher({ registry: registryWithEchoTool() });
    const result = await dispatcher.dispatch(
      { kind: 'tool_call', call: { toolName: 'nope', input: {}, callId: 'c2' } },
      CTX,
    );
    expect(result.kind).toBe('tool_error');
    if (result.kind === 'tool_error') {
      expect(result.message).toContain('tool not found');
    }
  });

  it('maps a schema-invalid input to tool_error (zod gate)', async () => {
    const dispatcher = createToolDispatcher({ registry: registryWithEchoTool() });
    const result = await dispatcher.dispatch(
      {
        kind: 'tool_call',
        call: { toolName: 'echo', input: { value: 'not-a-number' }, callId: 'c3' },
      },
      CTX,
    );
    expect(result.kind).toBe('tool_error');
    if (result.kind === 'tool_error') {
      expect(result.message).toContain('input-invalid');
    }
  });

  it('maps an executor throw to tool_error (never throws out)', async () => {
    const registry = createBrainToolRegistry();
    registry.register({
      name: 'boom',
      description: 'always throws',
      schemaIn: z.object({}),
      schemaOut: z.object({}),
      tier: 'read',
      requiresApproval: false,
      executor: async () => {
        throw new Error('kaboom');
      },
    });
    const dispatcher = createToolDispatcher({ registry });
    const result = await dispatcher.dispatch(
      { kind: 'tool_call', call: { toolName: 'boom', input: {}, callId: 'c4' } },
      CTX,
    );
    expect(result.kind).toBe('tool_error');
    if (result.kind === 'tool_error') {
      expect(result.message).toContain('executor-failed');
    }
  });

  it('maps respond_to_owner / final to response', async () => {
    const dispatcher = createToolDispatcher({ registry: registryWithEchoTool() });
    const r1 = await dispatcher.dispatch(
      { kind: 'respond_to_owner', text: 'hello' },
      CTX,
    );
    expect(r1.kind).toBe('response');
    if (r1.kind === 'response') expect(r1.text).toBe('hello');
    const r2 = await dispatcher.dispatch({ kind: 'final', text: 'bye' }, CTX);
    expect(r2.kind).toBe('response');
  });

  it('maps schedule_wake / monitor to their acks', async () => {
    const dispatcher = createToolDispatcher({ registry: registryWithEchoTool() });
    const wake = await dispatcher.dispatch(
      {
        kind: 'schedule_wake',
        wake: { wakeAt: '2026-01-01', reason: 'follow-up', resumeToken: 'rt' },
      },
      CTX,
    );
    expect(wake.kind).toBe('wake_ack');
    if (wake.kind === 'wake_ack') expect(wake.resumeToken).toBe('rt');
    const mon = await dispatcher.dispatch(
      {
        kind: 'monitor',
        watch: { watchId: 'w_1', predicate: 'x>0', timeoutMs: 1000 },
      },
      CTX,
    );
    expect(mon.kind).toBe('monitor_ack');
  });

  it('acks a spawn and preserves the background flag', async () => {
    const dispatcher = createToolDispatcher({ registry: registryWithEchoTool() });
    const result = await dispatcher.dispatch(
      {
        kind: 'spawn_sub_md',
        spawn: {
          subMdId: 'sm_1',
          scope: SCOPE,
          initialInput: {},
          background: true,
        },
      },
      CTX,
    );
    expect(result.kind).toBe('spawn_ack');
    if (result.kind === 'spawn_ack') {
      expect(result.subMdId).toBe('sm_1');
      expect(result.background).toBe(true);
    }
  });

  it('invokes an injected spawnHandler when wired', async () => {
    let handled = '';
    const dispatcher = createToolDispatcher({
      registry: registryWithEchoTool(),
      spawnHandler: async (spawn) => {
        handled = spawn.subMdId;
        return { handoffToken: 'real_handoff' };
      },
    });
    const result = await dispatcher.dispatch(
      {
        kind: 'spawn_sub_md',
        spawn: { subMdId: 'sm_2', scope: SCOPE, initialInput: {} },
      },
      CTX,
    );
    expect(handled).toBe('sm_2');
    if (result.kind === 'spawn_ack') {
      expect(result.handoffToken).toBe('real_handoff');
    }
  });
});
